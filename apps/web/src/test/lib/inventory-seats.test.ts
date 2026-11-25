// Row 8 (AR-7): lib/inventory is the only writer of trips.seats_remaining.
// Every change leaves a capacity_changes row, give-backs count moved tickets
// only, nothing comes back on a cancelled trip, and a capacity edit or a
// recount sets seats_remaining to capacity minus the seats tickets hold.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "crypto";
import { seedOperator, cleanupOperator, seedBooking, testDb, adminAuth } from "../db-helpers";
import type { SeedResult } from "../db-helpers";
import { bookingItems, capacityChanges, tickets, trips, vessels } from "@openboat/db";
import { and, desc, eq } from "drizzle-orm";
import {
  InventoryError,
  giveBackSeats,
  giveBackSeatsForTickets,
  recountSeats,
  setTripCapacity,
  takeSeats,
} from "@/lib/inventory/seats";
import { moveTickets } from "@/lib/tickets/lifecycle";

let ctx: SeedResult;

beforeAll(async () => {
  ctx = await seedOperator();
});

afterAll(async () => {
  await cleanupOperator(ctx.operatorId);
});

async function seedTrip(opts: { capacity: number; seatsRemaining: number; status?: "scheduled" | "cancelled" }) {
  const date = `2099-${String(1 + Math.floor(Math.random() * 12)).padStart(2, "0")}-${String(1 + Math.floor(Math.random() * 28)).padStart(2, "0")}`;
  const [t] = await testDb
    .insert(trips)
    .values({
      operatorId: ctx.operatorId,
      scheduleId: null,
      vesselId: ctx.vesselId,
      productId: ctx.productId,
      departureDate: date,
      startTime: new Date(`${date}T12:00:00Z`),
      endTime: new Date(`${date}T16:00:00Z`),
      capacity: opts.capacity,
      seatsRemaining: opts.seatsRemaining,
      status: opts.status ?? "scheduled",
    })
    .returning({ id: trips.id });
  return t.id;
}

async function seats(tripId: string) {
  const [t] = await testDb
    .select({ capacity: trips.capacity, seatsRemaining: trips.seatsRemaining })
    .from(trips)
    .where(eq(trips.id, tripId));
  return t;
}

async function ledger(tripId: string) {
  return testDb
    .select()
    .from(capacityChanges)
    .where(eq(capacityChanges.tripId, tripId))
    .orderBy(desc(capacityChanges.changedAt));
}

/** A held ticket on `tripId` for a fresh pending booking, without taking a seat. */
async function heldTicketOn(tripId: string) {
  const { bookingId } = await seedBooking(ctx, { status: "pending" });
  const [item] = await testDb
    .insert(bookingItems)
    .values({ bookingId, tripId, operatorId: ctx.operatorId, subtotalCents: 5000 })
    .returning({ id: bookingItems.id });
  const [ticket] = await testDb
    .insert(tickets)
    .values({
      bookingItemId: item.id,
      bookingId,
      operatorId: ctx.operatorId,
      ticketType: "adult",
      priceCents: 5000,
      listPriceCents: 5000,
      status: "held",
      qrPayload: randomUUID(),
    })
    .returning({ id: tickets.id, bookingId: tickets.bookingId, bookingItemId: tickets.bookingItemId });
  return ticket;
}

describe("takeSeats", () => {
  it("takes the seats and records a hold row", async () => {
    const tripId = await seedTrip({ capacity: 10, seatsRemaining: 10 });
    const { bookingId: realBooking } = await seedBooking(ctx, { status: "pending" });
    const left = await testDb.transaction((tx) =>
      takeSeats(tx, { operatorId: ctx.operatorId, tripId, seats: 3, bookingId: realBooking }),
    );
    expect(left).toBe(7);
    expect((await seats(tripId)).seatsRemaining).toBe(7);
    const [row] = await ledger(tripId);
    expect(row.reason).toBe("hold");
    expect(row.delta).toBe(-3);
    expect(row.seatsRemainingAfter).toBe(7);
    expect(row.bookingId).toBe(realBooking);
  });

  it("refuses rather than going negative, and leaves seats and ledger untouched", async () => {
    const tripId = await seedTrip({ capacity: 10, seatsRemaining: 2 });
    const { bookingId } = await seedBooking(ctx, { status: "pending" });
    await expect(
      testDb.transaction((tx) => takeSeats(tx, { operatorId: ctx.operatorId, tripId, seats: 3, bookingId })),
    ).rejects.toMatchObject({ code: "insufficient_seats", httpStatus: 409 });
    expect((await seats(tripId)).seatsRemaining).toBe(2);
    expect(await ledger(tripId)).toHaveLength(0);
  });

  it("refuses on a cancelled trip", async () => {
    const tripId = await seedTrip({ capacity: 10, seatsRemaining: 10, status: "cancelled" });
    const { bookingId } = await seedBooking(ctx, { status: "pending" });
    await expect(
      testDb.transaction((tx) => takeSeats(tx, { operatorId: ctx.operatorId, tripId, seats: 1, bookingId })),
    ).rejects.toBeInstanceOf(InventoryError);
  });
});

describe("giveBackSeats", () => {
  it("gives seats back and records the reason", async () => {
    const tripId = await seedTrip({ capacity: 10, seatsRemaining: 4 });
    const after = await testDb.transaction((tx) =>
      giveBackSeats(tx, { operatorId: ctx.operatorId, tripId, seats: 2, reason: "release" }),
    );
    expect(after).toBe(6);
    const [row] = await ledger(tripId);
    expect(row.reason).toBe("release");
    expect(row.delta).toBe(2);
    expect(row.seatsRemainingAfter).toBe(6);
  });

  it("gives nothing back on a cancelled trip (P4-7)", async () => {
    const tripId = await seedTrip({ capacity: 10, seatsRemaining: 10, status: "cancelled" });
    const after = await testDb.transaction((tx) =>
      giveBackSeats(tx, { operatorId: ctx.operatorId, tripId, seats: 2, reason: "refund" }),
    );
    expect(after).toBeNull();
    expect((await seats(tripId)).seatsRemaining).toBe(10);
    expect(await ledger(tripId)).toHaveLength(0);
  });
});

describe("giveBackSeatsForTickets", () => {
  it("returns one seat per ticket that moveTickets moved, on that ticket's trip, once", async () => {
    const tripId = await seedTrip({ capacity: 10, seatsRemaining: 8 });
    const a = await heldTicketOn(tripId);
    const b = await heldTicketOn(tripId);

    await testDb.transaction(async (tx) => {
      const moved = [
        ...(await moveTickets(tx, { operatorId: ctx.operatorId, ticketIds: [a.id] }, "held", "voided")),
        ...(await moveTickets(tx, { operatorId: ctx.operatorId, ticketIds: [b.id] }, "held", "voided")),
      ];
      expect(moved).toHaveLength(2);
      await giveBackSeatsForTickets(tx, ctx.operatorId, moved, "release");
    });
    expect((await seats(tripId)).seatsRemaining).toBe(10);
    const rows = await ledger(tripId);
    expect(rows).toHaveLength(1);
    expect(rows[0].delta).toBe(2);
    expect(rows[0].reason).toBe("release");

    // Moving them again moves nothing, so nothing comes back a second time.
    await testDb.transaction(async (tx) => {
      const moved = await moveTickets(tx, { operatorId: ctx.operatorId, ticketIds: [a.id, b.id] }, "held", "voided");
      expect(moved).toHaveLength(0);
      await giveBackSeatsForTickets(tx, ctx.operatorId, moved, "release");
    });
    expect((await seats(tripId)).seatsRemaining).toBe(10);
    expect(await ledger(tripId)).toHaveLength(1);
  });
});

describe("recountSeats", () => {
  it("sets seats_remaining to capacity minus seats taken and records the drift once", async () => {
    const tripId = await seedTrip({ capacity: 10, seatsRemaining: 10 });
    await heldTicketOn(tripId); // took no seat: drift of 1
    await heldTicketOn(tripId);

    const first = await testDb.transaction((tx) => recountSeats(tx, { operatorId: ctx.operatorId, tripId }));
    expect(first).toEqual({ tripId, before: 10, after: 8, drift: -2 });
    expect((await seats(tripId)).seatsRemaining).toBe(8);
    const rows = await ledger(tripId);
    expect(rows).toHaveLength(1);
    expect(rows[0].reason).toBe("recount");
    expect(rows[0].delta).toBe(-2);

    const second = await testDb.transaction((tx) => recountSeats(tx, { operatorId: ctx.operatorId, tripId }));
    expect(second?.drift).toBe(0);
    expect(await ledger(tripId)).toHaveLength(1);
  });

  it("leaves a cancelled trip alone", async () => {
    const tripId = await seedTrip({ capacity: 10, seatsRemaining: 3, status: "cancelled" });
    expect(await testDb.transaction((tx) => recountSeats(tx, { operatorId: ctx.operatorId, tripId }))).toBeNull();
    expect((await seats(tripId)).seatsRemaining).toBe(3);
  });
});

describe("setTripCapacity", () => {
  it("sets capacity and seats_remaining = capacity - taken, with a capacity_edit row", async () => {
    const tripId = await seedTrip({ capacity: 10, seatsRemaining: 10 });
    await heldTicketOn(tripId);
    const result = await testDb.transaction((tx) =>
      setTripCapacity(tx, adminAuth(ctx).ctx, { operatorId: ctx.operatorId, tripId, capacity: 14 }),
    );
    expect(result).toMatchObject({ capacity: 14, seatsRemaining: 13, taken: 1, sold: 0 });
    expect(await seats(tripId)).toEqual({ capacity: 14, seatsRemaining: 13 });
    const [row] = await ledger(tripId);
    expect(row).toMatchObject({
      reason: "capacity_edit",
      previousCapacity: 10,
      newCapacity: 14,
      delta: 3,
      seatsRemainingAfter: 13,
      staffId: ctx.staffId,
    });
  });

  it("refuses below the seats taken", async () => {
    const tripId = await seedTrip({ capacity: 10, seatsRemaining: 10 });
    await heldTicketOn(tripId);
    await heldTicketOn(tripId);
    await expect(
      testDb.transaction((tx) => setTripCapacity(tx, adminAuth(ctx).ctx, { operatorId: ctx.operatorId, tripId, capacity: 1 })),
    ).rejects.toMatchObject({ code: "below_taken", httpStatus: 422 });
  });

  it("enforces the vessel's certificate capacity when it has one, on any path", async () => {
    const tripId = await seedTrip({ capacity: 10, seatsRemaining: 10 });
    await testDb.update(vessels).set({ certificateCapacity: 12 }).where(eq(vessels.id, ctx.vesselId));
    try {
      await expect(
        testDb.transaction((tx) => setTripCapacity(tx, adminAuth(ctx).ctx, { operatorId: ctx.operatorId, tripId, capacity: 13 })),
      ).rejects.toMatchObject({ code: "over_certificate" });
      const ok = await testDb.transaction((tx) =>
        setTripCapacity(tx, adminAuth(ctx).ctx, { operatorId: ctx.operatorId, tripId, capacity: 12 }),
      );
      expect(ok.capacity).toBe(12);
    } finally {
      await testDb.update(vessels).set({ certificateCapacity: null }).where(eq(vessels.id, ctx.vesselId));
    }
  });

  it("requires a certificate capacity only when asked to (the mate path)", async () => {
    const tripId = await seedTrip({ capacity: 10, seatsRemaining: 10 });
    await expect(
      testDb.transaction((tx) =>
        setTripCapacity(tx, adminAuth(ctx).ctx, { operatorId: ctx.operatorId, tripId, capacity: 11, requireCertificate: true }),
      ),
    ).rejects.toMatchObject({ code: "no_certificate" });
    const ok = await testDb.transaction((tx) =>
      setTripCapacity(tx, adminAuth(ctx).ctx, { operatorId: ctx.operatorId, tripId, capacity: 11 }),
    );
    expect(ok.capacity).toBe(11);
  });

  it("refuses on a cancelled trip and for another operator's trip", async () => {
    const tripId = await seedTrip({ capacity: 10, seatsRemaining: 10, status: "cancelled" });
    await expect(
      testDb.transaction((tx) => setTripCapacity(tx, adminAuth(ctx).ctx, { operatorId: ctx.operatorId, tripId, capacity: 11 })),
    ).rejects.toMatchObject({ code: "cancelled", httpStatus: 409 });
    await expect(
      testDb.transaction((tx) => setTripCapacity(tx, adminAuth(ctx).ctx, { operatorId: randomUUID(), tripId, capacity: 11 })),
    ).rejects.toMatchObject({ code: "not_found", httpStatus: 404 });
  });
});

describe("ledger reconciliation", () => {
  it("sum(delta) over a trip's rows equals the change in seats_remaining", async () => {
    const tripId = await seedTrip({ capacity: 10, seatsRemaining: 10 });
    const { bookingId } = await seedBooking(ctx, { status: "pending" });
    await testDb.transaction(async (tx) => {
      await takeSeats(tx, { operatorId: ctx.operatorId, tripId, seats: 4, bookingId });
      await giveBackSeats(tx, { operatorId: ctx.operatorId, tripId, seats: 1, reason: "refund", bookingId });
      await setTripCapacity(tx, adminAuth(ctx).ctx, { operatorId: ctx.operatorId, tripId, capacity: 12 });
    });
    const rows = await ledger(tripId);
    const sum = rows.reduce((s, r) => s + (r.delta ?? 0), 0);
    expect((await seats(tripId)).seatsRemaining).toBe(10 + sum);
    expect(rows.map((r) => r.reason).sort()).toEqual(["capacity_edit", "hold", "refund"]);
    expect(
      await testDb
        .select()
        .from(capacityChanges)
        .where(and(eq(capacityChanges.tripId, tripId), eq(capacityChanges.bookingId, bookingId))),
    ).toHaveLength(2);
  });
});
