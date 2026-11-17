// Row 8 (AR-16): bookings.status and trips.status move only through one
// conditional UPDATE each, so a second caller moves nothing and the graph is
// enforced in one place.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { seedOperator, cleanupOperator, seedBooking, testDb } from "../db-helpers";
import type { SeedResult } from "../db-helpers";
import { bookings, trips } from "@openboat/db";
import { eq } from "drizzle-orm";
import { transitionBookings } from "@/lib/bookings/status";
import { transitionTrips } from "@/lib/trips/status";

let ctx: SeedResult;

beforeAll(async () => {
  ctx = await seedOperator();
});

afterAll(async () => {
  await cleanupOperator(ctx.operatorId);
});

async function seedTrip(startTime: Date, status: "scheduled" | "pending_settlement" | "sailed" | "cancelled") {
  const date = startTime.toISOString().slice(0, 10);
  const [t] = await testDb
    .insert(trips)
    .values({
      operatorId: ctx.operatorId,
      scheduleId: null,
      vesselId: ctx.vesselId,
      productId: ctx.productId,
      departureDate: date,
      startTime,
      endTime: new Date(startTime.getTime() + 4 * 3600_000),
      capacity: 10,
      seatsRemaining: 10,
      status,
    })
    .returning({ id: trips.id });
  return t.id;
}

describe("transitionBookings", () => {
  it("moves a booking once and stamps status_changed_at", async () => {
    const { bookingId } = await seedBooking(ctx, { status: "pending" });
    const now = new Date("2030-01-01T00:00:00Z");
    const scope = { operatorId: ctx.operatorId, bookingId };

    expect(await testDb.transaction((tx) => transitionBookings(tx, scope, "pending", "confirmed", now))).toEqual([
      bookingId,
    ]);
    expect(await testDb.transaction((tx) => transitionBookings(tx, scope, "pending", "confirmed", now))).toEqual([]);

    const [b] = await testDb.select().from(bookings).where(eq(bookings.id, bookingId));
    expect(b.status).toBe("confirmed");
    expect(b.statusChangedAt?.toISOString()).toBe(now.toISOString());
  });

  it("refuses moves the graph does not allow", async () => {
    const { bookingId } = await seedBooking(ctx, { status: "cancelled" });
    await expect(
      testDb.transaction((tx) =>
        transitionBookings(tx, { operatorId: ctx.operatorId, bookingId }, "cancelled", "confirmed"),
      ),
    ).rejects.toThrow(/can't move/);
    await expect(
      testDb.transaction((tx) =>
        transitionBookings(tx, { operatorId: ctx.operatorId, bookingId }, "confirmed", "pending"),
      ),
    ).rejects.toThrow(/can't move/);
  });

  it("is operator-scoped and accepts a list of ids", async () => {
    const a = await seedBooking(ctx, { status: "confirmed" });
    const b = await seedBooking(ctx, { status: "confirmed" });
    const other = await seedBooking(ctx, { status: "pending" });
    const moved = await testDb.transaction((tx) =>
      transitionBookings(
        tx,
        { operatorId: ctx.operatorId, bookingIds: [a.bookingId, b.bookingId, other.bookingId] },
        "confirmed",
        "cancelled",
      ),
    );
    expect(moved.sort()).toEqual([a.bookingId, b.bookingId].sort());
    expect(
      await testDb.transaction((tx) =>
        transitionBookings(tx, { operatorId: "00000000-0000-0000-0000-000000000000", bookingId: other.bookingId }, "pending", "cancelled"),
      ),
    ).toEqual([]);
    expect(await testDb.transaction((tx) => transitionBookings(tx, { operatorId: ctx.operatorId, bookingIds: [] }, "pending", "cancelled"))).toEqual([]);
  });
});

describe("transitionTrips", () => {
  it("settles by departure time and only from the expected status", async () => {
    const past = await seedTrip(new Date(Date.now() - 3 * 24 * 3600_000), "scheduled");
    const future = await seedTrip(new Date(Date.now() + 3 * 24 * 3600_000), "scheduled");
    const now = new Date();

    const step1 = await testDb.transaction((tx) =>
      transitionTrips(tx, { operatorId: ctx.operatorId, departedBefore: now }, "scheduled", "pending_settlement", {}, now),
    );
    expect(step1).toContain(past);
    expect(step1).not.toContain(future);

    const sailedAt = new Date();
    const step2 = await testDb.transaction((tx) =>
      transitionTrips(tx, { operatorId: ctx.operatorId, tripId: past }, "pending_settlement", "sailed", { sailedAt }, sailedAt),
    );
    expect(step2).toEqual([past]);
    const [t] = await testDb.select().from(trips).where(eq(trips.id, past));
    expect(t.status).toBe("sailed");
    expect(t.sailedAt?.toISOString()).toBe(sailedAt.toISOString());
    expect(t.statusChangedAt?.toISOString()).toBe(sailedAt.toISOString());

    // Already sailed: the same move again changes nothing.
    expect(
      await testDb.transaction((tx) =>
        transitionTrips(tx, { operatorId: ctx.operatorId, tripId: past }, "pending_settlement", "sailed"),
      ),
    ).toEqual([]);
  });

  it("cancels from scheduled, pending_settlement and sailed, never from cancelled", async () => {
    for (const from of ["scheduled", "pending_settlement", "sailed"] as const) {
      const id = await seedTrip(new Date(Date.now() + 24 * 3600_000), from);
      const moved = await testDb.transaction((tx) =>
        transitionTrips(tx, { operatorId: ctx.operatorId, tripId: id }, from, "cancelled", {
          cancelledAt: new Date(),
          cancellationReason: "weather",
        }),
      );
      expect(moved).toEqual([id]);
      const [t] = await testDb.select().from(trips).where(eq(trips.id, id));
      expect(t.status).toBe("cancelled");
      expect(t.cancellationReason).toBe("weather");
    }
    const id = await seedTrip(new Date(), "cancelled");
    await expect(
      testDb.transaction((tx) => transitionTrips(tx, { operatorId: ctx.operatorId, tripId: id }, "cancelled", "scheduled")),
    ).rejects.toThrow(/can't move/);
  });
});
