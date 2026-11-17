import { db } from "@/lib/db";
import { operators, bookingItems, tickets } from "@openboat/db";
import { and, eq, inArray } from "drizzle-orm";
import { isLive } from "@/lib/tickets/queries";
import { transitionTrips } from "@/lib/trips/status";

/**
 * Lazy sail-signal: called before any revenue read. Two-step transition:
 *   scheduled       + departure passed          → pending_settlement
 *   pending_settlement + grace window cleared   → sailed, tickets held → earned
 *
 * Safe to call repeatedly — WHERE clauses are idempotent.
 */
export async function settleTrips(operatorId: string): Promise<{ settled: number }> {
  const now = new Date();

  const [operator] = await db
    .select({ settleGraceHrs: operators.settleGraceHrs })
    .from(operators)
    .where(eq(operators.id, operatorId));

  const graceHrs = operator?.settleGraceHrs ?? 48;
  const graceCutoff = new Date(now.getTime() - graceHrs * 60 * 60 * 1000);

  return db.transaction(async (tx) => {
    // Step 1: scheduled → pending_settlement (departure has passed)
    await transitionTrips(tx, { operatorId, departedBefore: now }, "scheduled", "pending_settlement", {}, now);

    // Step 2: pending_settlement → sailed (grace window cleared)
    const tripIds = await transitionTrips(
      tx,
      { operatorId, departedBefore: graceCutoff },
      "pending_settlement",
      "sailed",
      { sailedAt: now },
      now,
    );
    if (tripIds.length === 0) return { settled: 0 };

    const items = await tx
      .select({ id: bookingItems.id })
      .from(bookingItems)
      .where(and(inArray(bookingItems.tripId, tripIds), eq(bookingItems.operatorId, operatorId)));
    const itemIds = items.map((i) => i.id);

    if (itemIds.length > 0) {
      await tx
        .update(tickets)
        .set({ feeStatus: "earned" })
        .where(
          and(
            inArray(tickets.bookingItemId, itemIds),
            eq(tickets.feeStatus, "held"),
            // Only paid tickets earn: an unpaid hold's fee was never charged.
            isLive,
          ),
        );
    }
    return { settled: tripIds.length };
  });
}
