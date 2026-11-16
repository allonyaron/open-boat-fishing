import { db } from "@/lib/db";
import { payments } from "@openboat/db";
import { eq } from "drizzle-orm";
import { moveTickets } from "@/lib/tickets/lifecycle";
import type Stripe from "stripe";

// Mark tickets disputed when a dispute is opened so the customer cannot board
// while the dispute is pending. The booking stays confirmed and the seats stay
// taken — if the dispute is won, tickets can be re-activated manually. If lost,
// a subsequent charge.refunded event will cancel the booking entirely.
export async function handleChargeDisputeCreated(dispute: Stripe.Dispute) {
  const piId = typeof dispute.payment_intent === "string" ? dispute.payment_intent : null;
  if (!piId) {
    console.error(`charge.dispute.created: no payment_intent on dispute ${dispute.id}`);
    return;
  }

  await db.transaction(async (tx) => {
    const [payment] = await tx
      .select({ bookingId: payments.bookingId, operatorId: payments.operatorId })
      .from(payments)
      .where(eq(payments.stripePaymentIntentId, piId));

    if (!payment) {
      console.error(
        `charge.dispute.created: no payment row for PI ${piId} — dispute ${dispute.id}`,
      );
      return;
    }

    // Only live tickets move, so a duplicate delivery changes nothing.
    const disputed = await moveTickets(
      tx,
      { operatorId: payment.operatorId, bookingId: payment.bookingId },
      "live",
      "disputed",
    );

    if (disputed.length === 0) return; // already disputed or refunded — idempotent

    console.error(
      `Dispute ${dispute.id} opened on booking ${payment.bookingId} (PI ${piId}) — ${disputed.length} tickets disputed pending resolution. Manual review required.`,
    );
  });
}
