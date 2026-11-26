import { and, eq, sql } from "drizzle-orm";
import type Stripe from "stripe";
import { db } from "@/lib/db";
import { stripe } from "@/lib/stripe";
import { paymentAccount } from "@/lib/stripe-account";
import { auditLog, payments, stripeEvents, tickets } from "@openboat/db";
import { recordAudit } from "@/lib/audit";
import { giveBackSeatsForTickets } from "@/lib/inventory/seats";
import { transitionBookings } from "@/lib/bookings/status";
import { moveTickets } from "@/lib/tickets/lifecycle";
import { holdsSeat } from "@/lib/tickets/queries";
import { isAppRefund } from "@/lib/webhooks/charge-refunded";
import { queueFeeRefund, sendCommand } from "./commands";
import type { RequestContext } from "@/lib/request-context";

// A partial refund the operator made in their own Stripe Dashboard (row 32)
// can't be matched to tickets, so its charge.refunded event needs review. On
// the Money page the office says which ticket it was: the ticket is marked
// refunded (the customer already has the money, so nothing is refunded to
// them again), its seat comes back, its platform fee goes back to the
// operator, and the booking is cancelled once nothing on it holds a seat
// (decided, user 2026-11-25). The tickets marked this way can't add up to more
// than was refunded outside the app; once they cover it, the item is done.

const ACTION = "ticket.outside_refund";

export type OutsideRefundResult =
  | { kind: "not_found" }
  /** The ticket isn't a live ticket on that booking (already refunded, say). */
  | { kind: "not_refundable" }
  /** Its price is more than what the Dashboard refunds have left to account for. */
  | { kind: "over_amount"; leftCents: number }
  | { kind: "marked"; feeReturnedCents: number; bookingCancelled: boolean; resolved: boolean };

/** The charge.refunded event's charge, if it is one this operator still has to review. */
async function reviewableCharge(operatorId: string, eventId: string) {
  const [event] = await db
    .select({ type: stripeEvents.type, account: stripeEvents.account, payload: stripeEvents.payload })
    .from(stripeEvents)
    .where(
      and(
        eq(stripeEvents.id, eventId),
        eq(stripeEvents.operatorId, operatorId),
        eq(stripeEvents.outcome, "needs_review"),
        sql`${stripeEvents.resolvedAt} is null`,
      ),
    );
  if (!event || event.type !== "charge.refunded") return null;
  const charge = (event.payload as Stripe.Event).data.object as Stripe.Charge;
  const piId = typeof charge.payment_intent === "string" ? charge.payment_intent : null;
  return piId ? { chargeId: charge.id, piId, account: event.account } : null;
}

/** Cents of ticket price already marked against this charge's outside refunds. */
async function markedCents(tx: Parameters<Parameters<typeof db.transaction>[0]>[0], operatorId: string, chargeId: string) {
  const [row] = await tx
    .select({ cents: sql<number>`coalesce(sum((${auditLog.after}->>'priceCents')::int), 0)::int` })
    .from(auditLog)
    .where(
      and(
        eq(auditLog.operatorId, operatorId),
        eq(auditLog.action, ACTION),
        sql`${auditLog.after}->>'chargeId' = ${chargeId}`,
      ),
    );
  return row?.cents ?? 0;
}

export async function markOutsideRefund(
  ctx: RequestContext,
  input: { operatorId: string; eventId: string; ticketId: string },
): Promise<OutsideRefundResult> {
  const { operatorId, eventId, ticketId } = input;
  const found = await reviewableCharge(operatorId, eventId);
  if (!found) return { kind: "not_found" };

  // What was refunded outside the app, asked of the account the charge is on.
  const refunds = await stripe.refunds.list({ charge: found.chargeId, limit: 100 }, paymentAccount(found.account));
  const outsideCents = refunds.data
    .filter((r) => !isAppRefund(r) && r.status !== "failed" && r.status !== "canceled")
    .reduce((sum, r) => sum + r.amount, 0);

  const result = await db.transaction(async (tx) => {
    // One mark at a time per payment, so two clicks can't both fit under the cap.
    const [payment] = await tx
      .select({
        bookingId: payments.bookingId,
        applicationFeeId: payments.applicationFeeId,
        stripeChargeId: payments.stripeChargeId,
      })
      .from(payments)
      .where(and(eq(payments.stripePaymentIntentId, found.piId), eq(payments.operatorId, operatorId)))
      .for("update");
    if (!payment) return { kind: "not_found" as const };

    const [ticket] = await tx
      .select({ priceCents: tickets.priceCents, feeCents: tickets.feeAmountCents })
      .from(tickets)
      .where(and(eq(tickets.id, ticketId), eq(tickets.bookingId, payment.bookingId), eq(tickets.operatorId, operatorId)));
    if (!ticket) return { kind: "not_refundable" as const };

    const leftCents = outsideCents - (await markedCents(tx, operatorId, found.chargeId));
    if (ticket.priceCents > leftCents) return { kind: "over_amount" as const, leftCents: Math.max(leftCents, 0) };

    const moved = await moveTickets(tx, { operatorId, ticketIds: [ticketId] }, "live", "refunded");
    if (moved.length === 0) return { kind: "not_refundable" as const };
    await giveBackSeatsForTickets(tx, operatorId, moved, "refund");

    const feeOrChargeId = payment.applicationFeeId ?? payment.stripeChargeId ?? found.chargeId;
    const feeCommandId =
      ticket.feeCents > 0
        ? await queueFeeRefund(tx, {
            ctx,
            operatorId,
            bookingId: payment.bookingId,
            feeOrChargeId,
            amountCents: ticket.feeCents,
            reason: "dashboard_refund_fee",
            metadata: { ticketId },
            dedupeKey: `outside-refund-fee:${ticketId}`,
          })
        : null;

    const [left] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(tickets)
      .where(and(eq(tickets.bookingId, payment.bookingId), eq(tickets.operatorId, operatorId), holdsSeat));
    const bookingCancelled =
      (left?.n ?? 0) === 0
        ? (await transitionBookings(tx, { operatorId, bookingId: payment.bookingId }, "confirmed", "cancelled")).length > 0
        : false;

    await recordAudit(tx, ctx, {
      operatorId,
      action: ACTION,
      targetTable: "tickets",
      targetId: ticketId,
      before: { status: "live" },
      after: {
        status: "refunded",
        chargeId: found.chargeId,
        priceCents: ticket.priceCents,
        eventId,
        bookingId: payment.bookingId,
        feeCommandId,
      },
    });

    // Every outside-refunded dollar is now on a ticket: nothing left to review.
    const resolved = ticket.priceCents >= leftCents;
    if (resolved) {
      await tx
        .update(stripeEvents)
        .set({ resolvedAt: ctx.now, resolvedBy: ctx.principal.kind === "staff" ? ctx.principal.staffId : null })
        .where(eq(stripeEvents.id, eventId));
      await recordAudit(tx, ctx, {
        operatorId,
        action: "stripe_event.resolve",
        targetTable: "stripe_events",
        targetId: eventId,
        after: { resolvedAt: ctx.now.toISOString(), by: ACTION },
      });
    }
    return { kind: "marked" as const, feeCommandId, feeReturnedCents: ticket.feeCents, bookingCancelled, resolved };
  });

  if (result.kind !== "marked") return result;
  if (result.feeCommandId) await sendCommand(result.feeCommandId);
  const { feeCommandId: _sent, ...marked } = result;
  return marked;
}
