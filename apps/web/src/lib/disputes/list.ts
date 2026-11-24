import { and, desc, eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { bookings, disputes, operatorDebts } from "@openboat/db";

// The Money page's chargeback list (row 11): each dispute on the operator's
// bookings, its state in plain words, and Stripe's fee the operator owes.

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
  /** Stripe's dispute fee the operator owes, once the dispute has closed. */
  fee: {
    cents: number;
    status: "owed" | "reserved" | "collected";
    /** The booking whose platform fee carried it. */
    collectedOn: string | null;
  } | null;
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
    })
    .from(disputes)
    .leftJoin(bookings, eq(bookings.id, disputes.bookingId))
    .where(eq(disputes.operatorId, operatorId))
    .orderBy(desc(disputes.openedAt))
    .limit(limit);
  if (rows.length === 0) return [];

  const debts = await db
    .select({
      disputeId: operatorDebts.disputeId,
      cents: operatorDebts.amountCents,
      status: operatorDebts.status,
      collectedOn: bookings.confirmationCode,
    })
    .from(operatorDebts)
    .leftJoin(bookings, eq(bookings.id, operatorDebts.bookingId))
    .where(
      and(
        eq(operatorDebts.operatorId, operatorId),
        inArray(
          operatorDebts.disputeId,
          rows.map((r) => r.id),
        ),
      ),
    );
  const debtOf = new Map(debts.map((d) => [d.disputeId, d]));

  return rows.map((r) => {
    const debt = debtOf.get(r.id);
    return {
      id: r.id,
      confirmationCode: r.confirmationCode,
      amountCents: r.amountCents,
      reason: r.reason,
      state: chargebackState(r.status),
      openedAt: r.openedAt.toISOString(),
      respondBy: r.respondBy?.toISOString() ?? null,
      closedAt: r.closedAt?.toISOString() ?? null,
      fee: debt
        ? {
            cents: debt.cents,
            status: debt.status,
            collectedOn: debt.status === "collected" ? debt.collectedOn : null,
          }
        : null,
    };
  });
}
