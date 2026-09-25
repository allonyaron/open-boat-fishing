import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { NextRequest } from "next/server";
import { seedOperator, cleanupOperator, seedBooking, testDb } from "../db-helpers";
import type { SeedResult } from "../db-helpers";
import { trips, bookings } from "@openboat/db";
import { eq } from "drizzle-orm";
import { vi } from "vitest";

// env.ts parses process.env once per test-file module registry, and DEMO_MODE
// isn't set in vitest.config.mts's test env block — mock @/lib/env directly to
// exercise the enabled path. cron-auth.ts also reads env.CRON_SECRET, so it
// must be preserved here too or verifyCronAuth always fails closed.
vi.mock("@/lib/env", () => ({
  env: { DEMO_MODE: "true", CRON_SECRET: process.env.CRON_SECRET },
}));

let ctx: SeedResult;

beforeAll(async () => {
  ctx = await seedOperator();
});

afterAll(async () => {
  await cleanupOperator(ctx.operatorId);
});

function req(operatorId?: string) {
  const headers: Record<string, string> = { Authorization: `Bearer ${process.env.CRON_SECRET}` };
  if (operatorId) headers["x-operator-id"] = operatorId;
  return new NextRequest("http://localhost/api/cron/reset-demo-data", { headers });
}

describe("GET /api/cron/reset-demo-data — DEMO_MODE enabled", () => {
  it("returns 500 when no operator header is present", async () => {
    const { GET } = await import("@/app/api/cron/reset-demo-data/route");
    const res = await GET(req());
    expect(res.status).toBe(500);
  });

  it("wipes booking activity and restores seat inventory for the resolved operator", async () => {
    const { bookingId } = await seedBooking(ctx, { status: "confirmed" });
    await testDb.update(trips).set({ seatsRemaining: 3 }).where(eq(trips.id, ctx.tripId));

    const { GET } = await import("@/app/api/cron/reset-demo-data/route");
    const res = await GET(req(ctx.operatorId));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.tripsReset).toBeGreaterThanOrEqual(1);

    const [trip] = await testDb
      .select({ seatsRemaining: trips.seatsRemaining, capacity: trips.capacity })
      .from(trips)
      .where(eq(trips.id, ctx.tripId));
    expect(trip.seatsRemaining).toBe(trip.capacity);

    const remaining = await testDb.select().from(bookings).where(eq(bookings.id, bookingId));
    expect(remaining).toHaveLength(0);
  });
});
