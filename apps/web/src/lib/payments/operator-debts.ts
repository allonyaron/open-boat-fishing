import { and, asc, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { operatorDebts } from "@openboat/db";

// What an operator owes the platform: Stripe's fee on a chargeback (row 11).
// Standard connected accounts can't be debited, so a debt rides on the
// platform fee of the operator's next booking:
//
// - reserveDebts, in the checkout transaction: owed debts that fit in the
//   booking's room are reserved to it, and checkout adds them to the
//   PaymentIntent's application_fee_amount. SKIP LOCKED, so two checkouts
//   never reserve the same debt.
// - collectDebts, when the payment succeeds: reserved -> collected.
// - releaseDebts, when the booking is cancelled unpaid: reserved -> owed, for
//   the next booking. A payment that lands after that is refunded in full,
//   platform fee included, so the debt is still owed.
//
// Refunds on the booking that carried a debt return only the tickets' own
// fees, so the debt stays collected.

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Executor = Tx | typeof db;

/** Records the operator's debt for a chargeback's Stripe fee, once per dispute. */
export async function recordDisputeFee(
  executor: Executor,
  input: { operatorId: string; disputeId: string; amountCents: number },
): Promise<void> {
  if (input.amountCents <= 0) return;
  await executor
    .insert(operatorDebts)
    .values({ operatorId: input.operatorId, kind: "dispute_fee", disputeId: input.disputeId, amountCents: input.amountCents })
    .onConflictDoNothing({ target: operatorDebts.disputeId });
}

/**
 * Reserves the operator's owed debts, oldest first, to a new booking, as many
 * as fit in `roomCents` (what the charge has left after the booking's own
 * platform fee). Returns the cents reserved, to add to the application fee.
 */
export async function reserveDebts(
  tx: Tx,
  input: { operatorId: string; bookingId: string; roomCents: number },
): Promise<number> {
  if (input.roomCents <= 0) return 0;
  const owed = await tx
    .select({ id: operatorDebts.id, amountCents: operatorDebts.amountCents })
    .from(operatorDebts)
    .where(and(eq(operatorDebts.operatorId, input.operatorId), eq(operatorDebts.status, "owed")))
    .orderBy(asc(operatorDebts.createdAt))
    .limit(20)
    .for("update", { skipLocked: true });

  let reserved = 0;
  for (const debt of owed) {
    if (reserved + debt.amountCents > input.roomCents) continue;
    await tx
      .update(operatorDebts)
      .set({ status: "reserved", bookingId: input.bookingId })
      .where(and(eq(operatorDebts.id, debt.id), eq(operatorDebts.status, "owed")));
    reserved += debt.amountCents;
  }
  return reserved;
}

/** The booking's payment succeeded: the debts it carried are collected. */
export async function collectDebts(tx: Tx, input: { operatorId: string; bookingId: string }): Promise<void> {
  await tx
    .update(operatorDebts)
    .set({ status: "collected", collectedAt: new Date() })
    .where(
      and(
        eq(operatorDebts.operatorId, input.operatorId),
        eq(operatorDebts.bookingId, input.bookingId),
        eq(operatorDebts.status, "reserved"),
      ),
    );
}

/** The booking was cancelled unpaid: its debts are owed again. */
export async function releaseDebts(tx: Tx, input: { operatorId: string; bookingId: string }): Promise<void> {
  await tx
    .update(operatorDebts)
    .set({ status: "owed", bookingId: null })
    .where(
      and(
        eq(operatorDebts.operatorId, input.operatorId),
        eq(operatorDebts.bookingId, input.bookingId),
        eq(operatorDebts.status, "reserved"),
      ),
    );
}

/** Cents of debt the booking's payment carried, on top of its own platform fee. */
export async function collectedOnBooking(operatorId: string, bookingId: string): Promise<number> {
  const [row] = await db
    .select({ cents: sql<number>`coalesce(sum(${operatorDebts.amountCents}), 0)::int` })
    .from(operatorDebts)
    .where(
      and(
        eq(operatorDebts.operatorId, operatorId),
        eq(operatorDebts.bookingId, bookingId),
        eq(operatorDebts.status, "collected"),
      ),
    );
  return row?.cents ?? 0;
}
