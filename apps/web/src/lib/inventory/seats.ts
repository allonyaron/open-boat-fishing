import { and, eq, inArray, ne, sql } from "drizzle-orm";
import { bookingItems, capacityChanges, trips, vessels } from "@openboat/db";
import type { db } from "@/lib/db";
import { liveTicketCount, seatHoldingTicketCount } from "@/lib/tickets/queries";
import type { MovedTicket } from "@/lib/tickets/lifecycle";

// The only code that changes trips.seats_remaining or trips.capacity (AR-7).
// Every change writes a capacity_changes row, so sum(delta) over a trip
// reconciles to its seats_remaining and a recount can say what drifted.
//
// Seats come back only for tickets that just left service, counted from the
// rows moveTickets returned, never from a caller's own count: a ticket
// refunded on its own, then refunded again with its booking, gives one seat
// back, not two. Nothing comes back on a cancelled trip (P4-7): its seats
// were reset when it was cancelled and it sells nothing.

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export type SeatChangeReason = (typeof capacityChanges.$inferInsert)["reason"] & string;

export type InventoryErrorCode =
  | "not_found"
  | "cancelled"
  | "insufficient_seats"
  | "below_taken"
  | "over_certificate"
  | "no_certificate";

export class InventoryError extends Error {
  constructor(
    message: string,
    public readonly code: InventoryErrorCode,
    public readonly httpStatus: 404 | 409 | 422,
  ) {
    super(message);
    this.name = "InventoryError";
  }
}

async function record(
  tx: Tx,
  row: {
    operatorId: string;
    tripId: string;
    delta: number;
    reason: SeatChangeReason;
    seatsRemainingAfter: number;
    bookingId?: string | null;
    ticketId?: string | null;
    staffId?: string | null;
    previousCapacity?: number | null;
    newCapacity?: number | null;
  },
) {
  await tx.insert(capacityChanges).values({
    operatorId: row.operatorId,
    tripId: row.tripId,
    delta: row.delta,
    reason: row.reason,
    seatsRemainingAfter: row.seatsRemainingAfter,
    bookingId: row.bookingId ?? null,
    ticketId: row.ticketId ?? null,
    staffId: row.staffId ?? null,
    previousCapacity: row.previousCapacity ?? null,
    newCapacity: row.newCapacity ?? null,
  });
}

/**
 * Takes `seats` from a scheduled trip for a new booking. The caller holds the
 * trip's row lock (POST /api/bookings locks every cart trip in id order).
 * Refuses, rather than going negative, if the seats aren't there.
 */
export async function takeSeats(
  tx: Tx,
  input: { operatorId: string; tripId: string; seats: number; bookingId: string },
): Promise<number> {
  const [row] = await tx
    .update(trips)
    .set({ seatsRemaining: sql`${trips.seatsRemaining} - ${input.seats}` })
    .where(
      and(
        eq(trips.id, input.tripId),
        eq(trips.operatorId, input.operatorId),
        eq(trips.status, "scheduled"),
        sql`${trips.seatsRemaining} >= ${input.seats}`,
      ),
    )
    .returning({ seatsRemaining: trips.seatsRemaining });

  if (!row) {
    throw new InventoryError("Not enough seats available", "insufficient_seats", 409);
  }
  await record(tx, {
    operatorId: input.operatorId,
    tripId: input.tripId,
    delta: -input.seats,
    reason: "hold",
    seatsRemainingAfter: row.seatsRemaining,
    bookingId: input.bookingId,
  });
  return row.seatsRemaining;
}

/**
 * Gives `seats` back to a trip that is not cancelled. Returns the new
 * seats_remaining, or null when the trip is cancelled (nothing changes).
 */
export async function giveBackSeats(
  tx: Tx,
  input: {
    operatorId: string;
    tripId: string;
    seats: number;
    reason: SeatChangeReason;
    bookingId?: string | null;
    ticketId?: string | null;
  },
): Promise<number | null> {
  if (input.seats <= 0) return null;
  const [row] = await tx
    .update(trips)
    .set({ seatsRemaining: sql`${trips.seatsRemaining} + ${input.seats}` })
    .where(
      and(
        eq(trips.id, input.tripId),
        eq(trips.operatorId, input.operatorId),
        ne(trips.status, "cancelled"),
      ),
    )
    .returning({ seatsRemaining: trips.seatsRemaining });

  if (!row) return null;
  await record(tx, {
    operatorId: input.operatorId,
    tripId: input.tripId,
    delta: input.seats,
    reason: input.reason,
    seatsRemainingAfter: row.seatsRemaining,
    bookingId: input.bookingId,
    ticketId: input.ticketId,
  });
  return row.seatsRemaining;
}

/**
 * Gives back one seat per ticket that moveTickets just took out of service,
 * on each ticket's own trip. This is the only way a cancellation or refund
 * returns seats.
 */
export async function giveBackSeatsForTickets(
  tx: Tx,
  operatorId: string,
  moved: MovedTicket[],
  reason: SeatChangeReason,
): Promise<void> {
  if (moved.length === 0) return;

  const itemIds = [...new Set(moved.map((t) => t.bookingItemId))];
  const items = await tx
    .select({ id: bookingItems.id, tripId: bookingItems.tripId })
    .from(bookingItems)
    .where(and(inArray(bookingItems.id, itemIds), eq(bookingItems.operatorId, operatorId)));
  const tripOf = new Map(items.map((i) => [i.id, i.tripId]));

  const byTrip = new Map<string, MovedTicket[]>();
  for (const t of moved) {
    const tripId = tripOf.get(t.bookingItemId);
    if (!tripId) continue;
    byTrip.set(tripId, [...(byTrip.get(tripId) ?? []), t]);
  }

  // Trips in id order: the same order every other seat writer locks them in.
  for (const tripId of [...byTrip.keys()].sort()) {
    const tripTickets = byTrip.get(tripId)!;
    await giveBackSeats(tx, {
      operatorId,
      tripId,
      seats: tripTickets.length,
      reason,
      bookingId: tripTickets[0].bookingId,
      ticketId: tripTickets.length === 1 ? tripTickets[0].id : null,
    });
  }
}

export type RecountResult = { tripId: string; before: number; after: number; drift: number };

/**
 * Sets seats_remaining to capacity minus the seats its tickets hold (live,
 * held, disputed), under the trip lock, and records the correction if there
 * was one. Cancelled trips are left alone.
 */
export async function recountSeats(
  tx: Tx,
  input: { operatorId: string; tripId: string; staffId?: string | null },
): Promise<RecountResult | null> {
  const [trip] = await tx
    .select({
      id: trips.id,
      capacity: trips.capacity,
      seatsRemaining: trips.seatsRemaining,
      status: trips.status,
      taken: seatHoldingTicketCount(),
    })
    .from(trips)
    .where(and(eq(trips.id, input.tripId), eq(trips.operatorId, input.operatorId)))
    .for("update", { of: trips });

  if (!trip || trip.status === "cancelled") return null;

  const after = Math.max(0, trip.capacity - trip.taken);
  const drift = after - trip.seatsRemaining;
  if (drift !== 0) {
    await tx
      .update(trips)
      .set({ seatsRemaining: after, updatedAt: new Date() })
      .where(eq(trips.id, trip.id));
    await record(tx, {
      operatorId: input.operatorId,
      tripId: trip.id,
      delta: drift,
      reason: "recount",
      seatsRemainingAfter: after,
      staffId: input.staffId,
    });
  }
  return { tripId: trip.id, before: trip.seatsRemaining, after, drift };
}

/**
 * Recounts every not-cancelled trip of an operator departing in the window
 * and returns the ones that had drifted. Meant for the nightly cron; the
 * caller logs or alerts on what comes back.
 */
export async function recountUpcomingTrips(
  tx: Tx,
  input: { operatorId: string; from: Date; to: Date },
): Promise<RecountResult[]> {
  const upcoming = await tx
    .select({ id: trips.id })
    .from(trips)
    .where(
      and(
        eq(trips.operatorId, input.operatorId),
        ne(trips.status, "cancelled"),
        sql`${trips.startTime} >= ${input.from}`,
        sql`${trips.startTime} < ${input.to}`,
      ),
    )
    .orderBy(trips.id);

  const drifted: RecountResult[] = [];
  for (const t of upcoming) {
    const r = await recountSeats(tx, { operatorId: input.operatorId, tripId: t.id });
    if (r && r.drift !== 0) drifted.push(r);
  }
  return drifted;
}

export type CapacityResult = {
  capacity: number;
  seatsRemaining: number;
  /** Paid tickets on the trip. */
  sold: number;
  /** Seats the trip's tickets hold: live, held and disputed. */
  taken: number;
  certificateCapacity: number | null;
};

/**
 * Changes a trip's capacity. Refuses on a cancelled trip, above the vessel's
 * certificate capacity (when it has one, or always with requireCertificate),
 * and below the seats already taken. seats_remaining becomes capacity minus
 * seats taken: a recount by construction, so an edit can't carry drift along.
 */
export async function setTripCapacity(
  tx: Tx,
  input: {
    operatorId: string;
    tripId: string;
    capacity: number;
    staffId?: string | null;
    /** The mate path: a vessel with no certificate capacity can't be edited from the boat. */
    requireCertificate?: boolean;
  },
): Promise<CapacityResult> {
  const [trip] = await tx
    .select({
      id: trips.id,
      capacity: trips.capacity,
      seatsRemaining: trips.seatsRemaining,
      status: trips.status,
      certificateCapacity: vessels.certificateCapacity,
      sold: liveTicketCount(),
      taken: seatHoldingTicketCount(),
    })
    .from(trips)
    .innerJoin(vessels, eq(trips.vesselId, vessels.id))
    .where(and(eq(trips.id, input.tripId), eq(trips.operatorId, input.operatorId)))
    .for("update", { of: trips });

  if (!trip) throw new InventoryError("Trip not found", "not_found", 404);
  if (trip.status === "cancelled") {
    throw new InventoryError("Cannot edit a cancelled trip", "cancelled", 409);
  }
  if (trip.certificateCapacity === null && input.requireCertificate) {
    throw new InventoryError(
      "Certificate capacity not configured for this vessel — contact admin",
      "no_certificate",
      422,
    );
  }
  if (trip.certificateCapacity !== null && input.capacity > trip.certificateCapacity) {
    throw new InventoryError(
      `Cannot exceed certificate capacity of ${trip.certificateCapacity}`,
      "over_certificate",
      422,
    );
  }
  if (input.capacity < trip.taken) {
    throw new InventoryError(
      trip.taken > trip.sold
        ? `Cannot set capacity below seats already taken (${trip.taken}, including ${trip.taken - trip.sold} awaiting payment)`
        : `Cannot set capacity below tickets already sold (${trip.sold})`,
      "below_taken",
      422,
    );
  }

  const seatsRemaining = input.capacity - trip.taken;
  await tx
    .update(trips)
    .set({ capacity: input.capacity, seatsRemaining, updatedAt: new Date() })
    .where(eq(trips.id, trip.id));
  await record(tx, {
    operatorId: input.operatorId,
    tripId: trip.id,
    delta: seatsRemaining - trip.seatsRemaining,
    reason: "capacity_edit",
    seatsRemainingAfter: seatsRemaining,
    staffId: input.staffId,
    previousCapacity: trip.capacity,
    newCapacity: input.capacity,
  });

  return {
    capacity: input.capacity,
    seatsRemaining,
    sold: trip.sold,
    taken: trip.taken,
    certificateCapacity: trip.certificateCapacity,
  };
}
