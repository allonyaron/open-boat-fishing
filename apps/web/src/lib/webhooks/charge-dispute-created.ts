import { db } from "@/lib/db";
import { bookingItems, tickets, payments } from "@openboat/db";
import { and, eq, inArray } from "drizzle-orm";
import type Stripe from "stripe";

// Void tickets when a dispute is opened so the customer cannot board while the
// dispute is pending. The booking stays confirmed — if the dispute is won, tickets
// can be re-activated manually. If lost, a subsequent charge.refunded event will
// cancel the booking entirely.
export async function handleChargeDisputeCreated(dispute: Stripe.Dispute) {
  const piId = typeof dispute.payment_intent === "string" ? dispute.payment_intent : null;
  if (!piId) {
    console.error(`charge.dispute.created: no payment_intent on dispute ${dispute.id}`);
    return;
  }

  await db.transaction(async (tx) => {
    const [payment] = await tx
      .select({ bookingId: payments.bookingId })
      .from(payments)
      .where(eq(payments.stripePaymentIntentId, piId));

    if (!payment) {
      console.error(
        `charge.dispute.created: no payment row for PI ${piId} — dispute ${dispute.id}`,
      );
      return;
    }

    const itemRows = await tx
      .select({ id: bookingItems.id })
      .from(bookingItems)
      .where(eq(bookingItems.bookingId, payment.bookingId));

    const itemIds = itemRows.map((i) => i.id);
    if (itemIds.length === 0) return;

    // Guard duplicate delivery: skip tickets already voided
    const voided = await tx
      .update(tickets)
      .set({ voided: true, feeStatus: "reversed" })
      .where(and(inArray(tickets.bookingItemId, itemIds), eq(tickets.voided, false)))
      .returning({ id: tickets.id });

    if (voided.length === 0) return; // all already voided — idempotent

    console.error(
      `Dispute ${dispute.id} opened on booking ${payment.bookingId} (PI ${piId}) — ${voided.length} tickets voided pending resolution. Manual review required.`,
    );
  });
}
