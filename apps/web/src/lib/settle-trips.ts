import { db } from "@/lib/db";
import { operators, trips, bookingItems, tickets } from "@openboat/db";
import { and, eq, inArray, lt } from "drizzle-orm";

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

  // Step 1: scheduled → pending_settlement (departure has passed)
  await db
    .update(trips)
    .set({ status: "pending_settlement", updatedAt: now })
    .where(
      and(
        eq(trips.operatorId, operatorId),
        eq(trips.status, "scheduled"),
        lt(trips.startTime, now),
      ),
    );

  // Step 2: pending_settlement → sailed (grace window cleared)
  const tripsToSettle = await db
    .select({ id: trips.id })
    .from(trips)
    .where(
      and(
        eq(trips.operatorId, operatorId),
        eq(trips.status, "pending_settlement"),
        lt(trips.startTime, graceCutoff),
      ),
    );

  if (tripsToSettle.length === 0) return { settled: 0 };

  const tripIds = tripsToSettle.map((t) => t.id);

  const items = await db
    .select({ id: bookingItems.id })
    .from(bookingItems)
    .where(inArray(bookingItems.tripId, tripIds));

  const itemIds = items.map((i) => i.id);

  await db.transaction(async (tx) => {
    await tx
      .update(trips)
      .set({ status: "sailed", sailedAt: now, updatedAt: now })
      .where(inArray(trips.id, tripIds));

    if (itemIds.length > 0) {
      await tx
        .update(tickets)
        .set({ feeStatus: "earned" })
        .where(
          and(
            inArray(tickets.bookingItemId, itemIds),
            eq(tickets.feeStatus, "held"),
            eq(tickets.voided, false),
          ),
        );
    }
  });

  return { settled: tripsToSettle.length };
}
