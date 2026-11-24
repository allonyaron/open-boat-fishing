import { and, eq, gt, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { sendPushToEmails } from "@/lib/push";
import { bookingItems, bookings, payments, products, tickets, trips, vessels } from "@openboat/db";
import { moveTickets } from "@/lib/tickets/lifecycle";
import { holdsSeat } from "@/lib/tickets/queries";
import { giveBackSeatsForTickets } from "@/lib/inventory/seats";
import { transitionTrips } from "@/lib/trips/status";
import { transitionBookings } from "./status";
import { releaseDebts } from "@/lib/payments/operator-debts";
import { cancelPaymentIntentForRelease } from "./release";
import { queueFeeRefund, queueRefund, sendCommands } from "@/lib/payments/commands";

// Trip cancellation (row 9: P4-1, P4-8, P4-10). Two phases:
//
// 1. The trip moves to `cancelled` in a transaction of its own and commits.
//    Checkout takes seats only from a scheduled trip under the trip lock, so
//    from here on nothing new is sold on it.
// 2. Each booking with tickets on the trip is settled in its own transaction,
//    locking the booking first (the order every other booking writer uses):
//    - pending (unpaid): the whole booking is cancelled, on every trip it
//      covers, and its PaymentIntent is cancelled after commit. A payment that
//      lands anyway finds the booking cancelled and is refunded in full by the
//      succeeded handler.
//    - confirmed (paid): its live tickets on this trip are refunded. If no
//      ticket holding a seat is left on the booking, the refund is for
//      everything left on the payment and the booking is cancelled;
//      otherwise it is the tickets' net price.
//
// Phase 2 can be run again: a booking already settled moves nothing. If it
// dies partway, the expiry cron finishes it (finishCancelledTrips).

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** Whether a booking's trip-cancel refund is for everything left on the payment or for some cents. */
export type PlannedRefund = { amountCents: number | null } | null;

/**
 * The refund for a paid booking whose tickets on a cancelled trip were just
 * refunded. `paidCents` are those tickets' prices; `ticketsLeft` counts the
 * booking's tickets still holding a seat (live or disputed) after the move.
 * Exported for tests.
 */
export function planBookingRefund(paidCents: number[], ticketsLeft: number): PlannedRefund {
  if (paidCents.length === 0) return null;
  if (ticketsLeft === 0) return { amountCents: null };
  const cents = paidCents.reduce((sum, c) => sum + c, 0);
  return cents > 0 ? { amountCents: cents } : null;
}

type Settled =
  | { kind: "none" }
  | {
      kind: "pending";
      bookingId: string;
      paymentIntentId: string | null;
      email: string | null;
      ticketsOut: number;
    }
  | {
      kind: "paid";
      bookingId: string;
      email: string | null;
      ticketsOut: number;
      cancelled: boolean;
      commandId: string | null;
      feeCommandId: string | null;
    };

async function settleBooking(
  tx: Tx,
  input: { operatorId: string; tripId: string; bookingId: string; reason: string | null },
): Promise<Settled> {
  const { operatorId, tripId, bookingId } = input;
  const [booking] = await tx
    .select({
      status: bookings.status,
      email: bookings.customerEmail,
      paymentIntentId: bookings.stripePaymentIntentId,
      applicationFeeId: payments.applicationFeeId,
    })
    .from(bookings)
    .leftJoin(payments, eq(payments.bookingId, bookings.id))
    .where(and(eq(bookings.id, bookingId), eq(bookings.operatorId, operatorId)))
    .for("update", { of: bookings });
  if (!booking || booking.status === "cancelled") return { kind: "none" };

  if (booking.status === "pending") {
    // Unpaid: none of it can be paid for now, so the whole booking goes. Its
    // seats on other trips come back; this trip is cancelled and gives none.
    const moved = await moveTickets(tx, { operatorId, bookingId }, "held", "voided");
    await giveBackSeatsForTickets(tx, operatorId, moved, "trip_cancel");
    const done = await transitionBookings(tx, { operatorId, bookingId }, "pending", "cancelled");
    if (done.length === 0) return { kind: "none" };
    await releaseDebts(tx, { operatorId, bookingId });
    return {
      kind: "pending",
      bookingId,
      paymentIntentId: booking.paymentIntentId,
      email: booking.email,
      ticketsOut: moved.length,
    };
  }

  const items = await tx
    .select({ id: bookingItems.id })
    .from(bookingItems)
    .where(
      and(
        eq(bookingItems.bookingId, bookingId),
        eq(bookingItems.tripId, tripId),
        eq(bookingItems.operatorId, operatorId),
      ),
    );
  const refunded = await moveTickets(
    tx,
    { operatorId, bookingItemIds: items.map((i) => i.id) },
    "live",
    "refunded",
  );
  if (refunded.length === 0) return { kind: "none" };
  await giveBackSeatsForTickets(tx, operatorId, refunded, "trip_cancel");

  // What the tickets just refunded paid, net of any discount. A ticket
  // refunded on its own earlier wasn't live, so it isn't refunded again.
  const paid = await tx
    .select({ priceCents: tickets.priceCents, feeCents: tickets.feeAmountCents })
    .from(tickets)
    .where(and(inArray(tickets.id, refunded.map((t) => t.id)), eq(tickets.operatorId, operatorId)));
  const left = await tx
    .select({ id: tickets.id })
    .from(tickets)
    .where(and(eq(tickets.bookingId, bookingId), eq(tickets.operatorId, operatorId), holdsSeat));

  const plan = planBookingRefund(
    paid.map((t) => t.priceCents),
    left.length,
  );
  // With the fee's id, exactly these tickets' platform fees are refunded,
  // as the office ticket refund does; in proportion, Stripe would also hand
  // back a chargeback fee the payment carried for the operator (row 11).
  const exactFee = !!booking.applicationFeeId;
  const metadata = { tripId, ...(input.reason && { cancelReason: input.reason.slice(0, 200) }) };
  const commandId =
    plan && booking.paymentIntentId
      ? await queueRefund(tx, {
          operatorId,
          bookingId,
          paymentIntentId: booking.paymentIntentId,
          amountCents: plan.amountCents,
          reason: "trip_cancelled",
          reverseTransfer: true,
          refundApplicationFee: !exactFee,
          metadata,
          dedupeKey: `trip-cancel:${tripId}:${bookingId}`,
        })
      : null;
  const feeCents = paid.reduce((sum, t) => sum + t.feeCents, 0);
  const feeCommandId =
    commandId && exactFee && feeCents > 0
      ? await queueFeeRefund(tx, {
          operatorId,
          bookingId,
          applicationFeeId: booking.applicationFeeId!,
          amountCents: feeCents,
          reason: "trip_cancelled",
          metadata,
          dedupeKey: `trip-cancel-fee:${tripId}:${bookingId}`,
        })
      : null;

  const cancelled =
    left.length === 0
      ? (await transitionBookings(tx, { operatorId, bookingId }, "confirmed", "cancelled")).length > 0
      : false;

  return {
    kind: "paid",
    bookingId,
    email: booking.email,
    ticketsOut: refunded.length,
    cancelled,
    commandId,
    feeCommandId,
  };
}

export type TripCancelOutcome = {
  bookingsCancelled: number;
  ticketsOut: number;
  refunds: { sent: number; queued: number; failed: number };
  /** Unpaid bookings whose PaymentIntent couldn't be cancelled; a late payment is refunded. */
  paymentsNotCancelled: number;
};

/**
 * Phase 2: settles every booking still holding tickets on a cancelled trip,
 * sends the refunds and PaymentIntent cancels, and tells the customers.
 * Returns null when there was nothing left to settle.
 */
export async function finishTripCancellation(
  operatorId: string,
  tripId: string,
  reason: string | null,
): Promise<TripCancelOutcome | null> {
  // Read after phase 1 committed, so it includes every booking ever sold on
  // the trip. Cancelled bookings have nothing left to settle.
  const rows = await db
    .selectDistinct({ bookingId: bookingItems.bookingId })
    .from(bookingItems)
    .innerJoin(bookings, eq(bookings.id, bookingItems.bookingId))
    .where(
      and(
        eq(bookingItems.tripId, tripId),
        eq(bookingItems.operatorId, operatorId),
        inArray(bookings.status, ["pending", "confirmed"]),
      ),
    );

  const settled: Settled[] = [];
  for (const { bookingId } of rows.sort((a, b) => a.bookingId.localeCompare(b.bookingId))) {
    settled.push(await db.transaction((tx) => settleBooking(tx, { operatorId, tripId, bookingId, reason })));
  }
  const acted = settled.filter((s): s is Exclude<Settled, { kind: "none" }> => s.kind !== "none");
  if (acted.length === 0) return null;

  // After commit: first the unpaid bookings' PaymentIntents, which nothing
  // retries once their booking is cancelled, then the refunds (what doesn't
  // go through stays queued for the cron). The booking is already cancelled,
  // so the canceled webhook sends no push of its own. A payment that went
  // through anyway is refunded in full by the succeeded handler.
  const paidOnes = acted.filter((s) => s.kind === "paid");
  const unpaidEmails: string[] = [];
  const paidEmails = paidOnes.flatMap((s) => (s.email ? [s.email] : []));
  let paymentsNotCancelled = 0;
  for (const s of acted) {
    if (s.kind !== "pending") continue;
    const pi = s.paymentIntentId
      ? await cancelPaymentIntentForRelease(s.paymentIntentId, "requested_by_customer")
      : "canceled";
    if (pi !== "canceled") paymentsNotCancelled++;
    if (s.email) (pi === "paid" ? paidEmails : unpaidEmails).push(s.email);
  }
  const sent = await sendCommands(paidOnes.flatMap((s) => (s.commandId ? [s.commandId] : [])));
  await sendCommands(paidOnes.flatMap((s) => (s.feeCommandId ? [s.feeCommandId] : [])));

  await notifyTripCancelled(operatorId, tripId, { paid: paidEmails, unpaid: unpaidEmails });

  return {
    bookingsCancelled: acted.filter((s) => s.kind === "pending" || s.cancelled).length,
    ticketsOut: acted.reduce((n, s) => n + s.ticketsOut, 0),
    refunds: { sent: sent.sent + sent.confirmed, queued: sent.pending, failed: sent.failed },
    paymentsNotCancelled,
  };
}

export type CancelTripResult =
  | { kind: "not_found" }
  | { kind: "already_cancelled" }
  | ({ kind: "cancelled" } & TripCancelOutcome);

/**
 * Cancels a trip: phase 1 closes sales, phase 2 settles its bookings. On a
 * trip that is already cancelled it finishes whatever phase 2 left undone,
 * and reports already_cancelled when nothing was.
 */
export async function cancelTrip(
  operatorId: string,
  tripId: string,
  reason: string | null,
  now: Date = new Date(),
): Promise<CancelTripResult> {
  const phase1 = await db.transaction(async (tx) => {
    const [trip] = await tx
      .select({ status: trips.status })
      .from(trips)
      .where(and(eq(trips.id, tripId), eq(trips.operatorId, operatorId)))
      .for("update");
    if (!trip) return "not_found" as const;
    if (trip.status === "cancelled") return "was_cancelled" as const;
    if (trip.status === "sailed") {
      // Allowed (weather calls can come late), but it refunds a boat that went out (P4-9).
      console.warn(`Cancelling an already-sailed trip: ${tripId} — requires manual review`);
    }
    await transitionTrips(
      tx,
      { operatorId, tripId },
      trip.status,
      "cancelled",
      { cancelledAt: now, cancellationReason: reason },
      now,
    );
    return "cancelled_now" as const;
  });
  if (phase1 === "not_found") return { kind: "not_found" };

  const outcome = await finishTripCancellation(operatorId, tripId, reason);
  if (!outcome) {
    if (phase1 === "was_cancelled") return { kind: "already_cancelled" };
    return {
      kind: "cancelled",
      bookingsCancelled: 0,
      ticketsOut: 0,
      refunds: { sent: 0, queued: 0, failed: 0 },
      paymentsNotCancelled: 0,
    };
  }
  return { kind: "cancelled", ...outcome };
}

/**
 * Finishes trips cancelled in the last week whose bookings phase 2 didn't
 * settle (the request died partway). Run by the expiry cron. Returns how many
 * trips it finished.
 */
export async function finishCancelledTrips(now: Date = new Date()): Promise<number> {
  const since = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const unsettled = await db
    .selectDistinct({ tripId: trips.id, operatorId: trips.operatorId, reason: trips.cancellationReason })
    .from(trips)
    .innerJoin(bookingItems, eq(bookingItems.tripId, trips.id))
    .innerJoin(bookings, eq(bookings.id, bookingItems.bookingId))
    .innerJoin(tickets, eq(tickets.bookingItemId, bookingItems.id))
    .where(
      and(
        eq(trips.status, "cancelled"),
        gt(trips.cancelledAt, since),
        inArray(bookings.status, ["pending", "confirmed"]),
        inArray(tickets.status, ["held", "live"]),
        eq(tickets.voided, false),
      ),
    );

  let finished = 0;
  for (const t of unsettled) {
    try {
      if (await finishTripCancellation(t.operatorId, t.tripId, t.reason)) finished++;
    } catch (err) {
      console.error(`Couldn't finish cancelling trip ${t.tripId}:`, err);
    }
  }
  return finished;
}

/** Best-effort pushes: paid passengers get a refund note, unpaid ones are told they weren't charged. */
async function notifyTripCancelled(
  operatorId: string,
  tripId: string,
  emails: { paid: string[]; unpaid: string[] },
): Promise<void> {
  if (emails.paid.length === 0 && emails.unpaid.length === 0) return;
  const [detail] = await db
    .select({ vesselName: vessels.name, productName: products.displayName })
    .from(trips)
    .innerJoin(vessels, eq(trips.vesselId, vessels.id))
    .innerJoin(products, eq(trips.productId, products.id))
    .where(and(eq(trips.id, tripId), eq(trips.operatorId, operatorId)));
  const what = detail ? `Your ${detail.vesselName} ${detail.productName} has been cancelled.` : "Your trip has been cancelled.";
  const data = { type: "trip_cancelled", tripId };

  const sends: Promise<unknown>[] = [];
  if (emails.paid.length > 0) {
    sends.push(
      sendPushToEmails(
        operatorId,
        emails.paid,
        { title: "Trip Cancelled", body: `${what} Your refund is on the way.`, data },
        "cancellations",
      ),
    );
  }
  if (emails.unpaid.length > 0) {
    sends.push(
      sendPushToEmails(
        operatorId,
        emails.unpaid,
        { title: "Trip Cancelled", body: `${what} Your booking was cancelled and you haven't been charged.`, data },
        "cancellations",
      ),
    );
  }
  await Promise.all(sends).catch((err) => console.error("Push error on trip cancellation:", err));
}
