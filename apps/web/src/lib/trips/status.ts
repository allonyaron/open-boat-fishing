import { and, eq, inArray, lt, type SQL } from "drizzle-orm";
import { trips } from "@openboat/db";
import type { db } from "@/lib/db";

// The only code that changes trips.status (AR-16). Every move is a
// conditional UPDATE from one status to another; callers act only on the
// ids returned.

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export type TripStatus = "scheduled" | "pending_settlement" | "sailed" | "cancelled";

/**
 * scheduled -> pending_settlement: departure has passed (settlement step 1).
 * pending_settlement -> sailed: the settle grace window cleared; fees earn.
 * scheduled | pending_settlement | sailed -> cancelled: staff cancelled the
 * trip. Cancelling a sailed trip is allowed (weather calls can come late) and
 * the caller is expected to warn about it (P4-9).
 */
const ALLOWED: Record<TripStatus, readonly TripStatus[]> = {
  scheduled: ["pending_settlement", "cancelled"],
  pending_settlement: ["sailed", "cancelled"],
  sailed: ["cancelled"],
  cancelled: [],
};

export type TripScope = { operatorId: string } & (
  | { tripId: string }
  | { tripIds: string[] }
  /** Every trip of the operator in `from` whose departure is before this instant. */
  | { departedBefore: Date }
);

function scopeFilter(scope: TripScope): SQL {
  if ("tripId" in scope) return eq(trips.id, scope.tripId);
  if ("tripIds" in scope) return inArray(trips.id, scope.tripIds);
  return lt(trips.startTime, scope.departedBefore);
}

export type TripTransitionExtra = Partial<{
  sailedAt: Date;
  cancelledAt: Date;
  cancellationReason: string | null;
}>;

/**
 * Moves the scoped trips that are in `from` to `to` and returns the ids it
 * moved. Run it in the caller's transaction.
 */
export async function transitionTrips(
  tx: Tx,
  scope: TripScope,
  from: TripStatus,
  to: TripStatus,
  extra: TripTransitionExtra = {},
  now: Date = new Date(),
): Promise<string[]> {
  if (!ALLOWED[from].includes(to)) {
    throw new Error(`Trip status can't move from ${from} to ${to}`);
  }
  if ("tripIds" in scope && scope.tripIds.length === 0) return [];

  const rows = await tx
    .update(trips)
    .set({ status: to, statusChangedAt: now, updatedAt: now, ...extra })
    .where(and(eq(trips.operatorId, scope.operatorId), scopeFilter(scope), eq(trips.status, from)))
    .returning({ id: trips.id });
  return rows.map((r) => r.id);
}
