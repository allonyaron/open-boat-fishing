import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";
import { eq } from "drizzle-orm";
import { trips } from "@openboat/db";
import { currentMonthET, getTripsForMonth, isValidMonth } from "@/lib/trips/month";
import { seedOperator, setTripDeparture, cleanupOperator, testDb } from "../db-helpers";

let ctx: Awaited<ReturnType<typeof seedOperator>>;
let other: Awaited<ReturnType<typeof seedOperator>>;
let startTime: Date;
const month = new Date().toISOString().slice(0, 7); // seedOperator's departureDate is today (UTC)

beforeAll(async () => {
  ctx = await seedOperator();
  other = await seedOperator();
  // The seeded trips leave at 7 AM ET; move them out of the past (P2-1).
  startTime = await setTripDeparture(ctx.tripId, 3 * 3_600_000);
  await setTripDeparture(other.tripId, 3 * 3_600_000);
  await testDb.update(trips).set({ onlineCutoffMinutes: 60 }).where(eq(trips.id, ctx.tripId));
});

afterAll(async () => {
  await cleanupOperator(ctx.operatorId);
  await cleanupOperator(other.operatorId);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("getTripsForMonth", () => {
  it("returns only the operator's own trips", async () => {
    const ids = (await getTripsForMonth(ctx.operatorId, month)).map((t) => t.id);
    expect(ids).toContain(ctx.tripId);
    expect(ids).not.toContain(other.tripId);
  });

  it("includes vessel and active prices", async () => {
    const [trip] = (await getTripsForMonth(ctx.operatorId, month)).filter((t) => t.id === ctx.tripId);
    expect(trip.vessel.id).toBe(ctx.vesselId);
    expect(trip.product.prices.map((p) => p.ticketType).sort()).toEqual(["adult", "child"]);
  });

  it("lists a trip until its online-sales cutoff, then drops it", async () => {
    const closeAt = startTime.getTime() - 60 * 60_000;

    const before = await getTripsForMonth(ctx.operatorId, month, new Date(closeAt - 1));
    expect(before.map((t) => t.id)).toContain(ctx.tripId);

    const at = await getTripsForMonth(ctx.operatorId, month, new Date(closeAt));
    expect(at.map((t) => t.id)).not.toContain(ctx.tripId);
  });
});

describe("isValidMonth", () => {
  it("accepts YYYY-MM with a real month only", () => {
    expect(isValidMonth("2026-01")).toBe(true);
    expect(isValidMonth("2026-12")).toBe(true);
    expect(isValidMonth("2026-00")).toBe(false);
    expect(isValidMonth("2026-13")).toBe(false);
    expect(isValidMonth("2026-1")).toBe(false);
  });
});

describe("currentMonthET", () => {
  it("stays on this month after 8 PM ET on the last evening, when UTC has rolled over", () => {
    // Only Date: full fake timers hang the pg client.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-31T23:30:00-04:00")); // 03:30 UTC on Nov 1
    expect(currentMonthET()).toBe("2026-10");
  });
});
