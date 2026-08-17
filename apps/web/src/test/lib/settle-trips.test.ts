import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { settleTrips } from "@/lib/settle-trips";
import { seedOperator, cleanupOperator, seedBooking, testDb } from "../db-helpers";
import { trips, tickets } from "@openboat/db";
import { eq } from "drizzle-orm";

let ctx: Awaited<ReturnType<typeof seedOperator>>;

beforeAll(async () => {
  ctx = await seedOperator();
});

afterAll(async () => {
  await cleanupOperator(ctx.operatorId);
});

describe("settleTrips", () => {
  it("moves a scheduled trip whose startTime has passed to pending_settlement", async () => {
    // Set startTime to 2 hours ago — past departure, within grace window
    await testDb
      .update(trips)
      .set({ startTime: new Date(Date.now() - 2 * 60 * 60 * 1000) })
      .where(eq(trips.id, ctx.tripId));

    const { settled } = await settleTrips(ctx.operatorId);

    const [trip] = await testDb
      .select({ status: trips.status })
      .from(trips)
      .where(eq(trips.id, ctx.tripId));

    expect(trip.status).toBe("pending_settlement");
    // Grace window (48h) not yet cleared — trip moved to pending but not sailed
    expect(settled).toBe(0);
  });

  it("moves a pending_settlement trip past grace to sailed and earns ticket fees", async () => {
    // Create a booking with a held ticket to verify fee transition
    await seedBooking(ctx, { status: "confirmed" });

    // Set startTime to 50 hours ago — past the default 48h grace window
    await testDb
      .update(trips)
      .set({
        startTime: new Date(Date.now() - 50 * 60 * 60 * 1000),
        status: "pending_settlement",
      })
      .where(eq(trips.id, ctx.tripId));

    const { settled } = await settleTrips(ctx.operatorId);

    const [trip] = await testDb
      .select({ status: trips.status })
      .from(trips)
      .where(eq(trips.id, ctx.tripId));

    expect(trip.status).toBe("sailed");
    expect(settled).toBe(1);

    // All non-voided held tickets should now be earned
    const ticketRows = await testDb
      .select({ feeStatus: tickets.feeStatus })
      .from(tickets)
      .where(eq(tickets.operatorId, ctx.operatorId));

    expect(ticketRows.length).toBeGreaterThan(0);
    for (const t of ticketRows) {
      expect(t.feeStatus).toBe("earned");
    }
  });

  it("does not affect trips belonging to a different operator", async () => {
    // settleTrips uses operatorId scoping — call with a random UUID
    const { settled } = await settleTrips("00000000-0000-0000-0000-000000000000");
    expect(settled).toBe(0);
  });
});
