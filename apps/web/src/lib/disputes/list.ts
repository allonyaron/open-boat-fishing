import { desc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { bookings, disputes } from "@openboat/db";

// The Money page's chargeback list (row 11): each dispute on the operator's
// bookings, its state in plain words, and the fee Stripe charged for it.

export type ChargebackState = "inquiry" | "open" | "under_review" | "won" | "lost" | "closed";

export type ChargebackRow = {
  id: string;
  confirmationCode: string | null;
  amountCents: number;
  reason: string;
  state: ChargebackState;
  openedAt: string;
  respondBy: string | null;
  closedAt: string | null;
  /**
   * Stripe's dispute fees net of any returned, once the dispute has closed.
   * Stripe takes them from the operator's own account (row 32).
   */
  stripeFeeCents: number | null;
};

export function chargebackState(status: string): ChargebackState {
  if (status === "won") return "won";
  if (status === "lost") return "lost";
  if (status === "warning_closed") return "closed";
  if (status.startsWith("warning_")) return "inquiry";
  if (status === "under_review") return "under_review";
  return "open";
}

export async function listChargebacks(operatorId: string, limit = 50): Promise<ChargebackRow[]> {
  const rows = await db
    .select({
      id: disputes.id,
      confirmationCode: bookings.confirmationCode,
      amountCents: disputes.amountCents,
      reason: disputes.reason,
      status: disputes.status,
      openedAt: disputes.openedAt,
      respondBy: disputes.respondBy,
      closedAt: disputes.closedAt,
      stripeFeeCents: disputes.stripeFeeCents,
    })
    .from(disputes)
    .leftJoin(bookings, eq(bookings.id, disputes.bookingId))
    .where(eq(disputes.operatorId, operatorId))
    .orderBy(desc(disputes.openedAt))
    .limit(limit);

  return rows.map((r) => ({
    id: r.id,
    confirmationCode: r.confirmationCode,
    amountCents: r.amountCents,
    reason: r.reason,
    state: chargebackState(r.status),
    openedAt: r.openedAt.toISOString(),
    respondBy: r.respondBy?.toISOString() ?? null,
    closedAt: r.closedAt?.toISOString() ?? null,
    stripeFeeCents: r.closedAt && r.stripeFeeCents ? r.stripeFeeCents : null,
  }));
}
