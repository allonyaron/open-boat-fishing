import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { NextRequest } from "next/server";
import { seedOperator, cleanupOperator, seedBooking, testDb } from "../db-helpers";
import type { SeedResult } from "../db-helpers";
import { trips, customers, pushTokens, magicLinkOtps, bookings } from "@openboat/db";
import { eq } from "drizzle-orm";

// env.ts parses process.env once per test-file module registry, and
// vitest.config.ts's test env block doesn't set DEMO_MODE — so the only way
// to exercise the enabled path is to mock @/lib/env directly for this file.
vi.mock("@/lib/env", () => ({
  env: { DEMO_MODE: "true" },
}));

vi.mock("@/lib/session", () => ({
  requireAdmin: vi.fn(),
}));

import { requireAdmin } from "@/lib/session";

let ctx: SeedResult;

beforeAll(async () => {
  ctx = await seedOperator();
  vi.mocked(requireAdmin).mockResolvedValue({
    session: { staffId: ctx.staffId, operatorId: ctx.operatorId, role: "admin" as const, name: "Admin" },
  } as any);
});

afterAll(async () => {
  await cleanupOperator(ctx.operatorId);
});

function postReq() {
  return new NextRequest("http://localhost/api/admin/demo/clear-customers", { method: "POST" });
}

describe("POST /api/admin/demo/clear-customers — DEMO_MODE enabled", () => {
  it("wipes booking activity, restores seats, and deletes customer accounts", async () => {
    const { bookingId } = await seedBooking(ctx, { status: "confirmed" });
    await testDb.update(trips).set({ seatsRemaining: 5 }).where(eq(trips.id, ctx.tripId));

    const [customer] = await testDb
      .insert(customers)
      .values({ operatorId: ctx.operatorId, email: "demo-customer@test.com" })
      .returning({ id: customers.id });
    await testDb.insert(pushTokens).values({
      operatorId: ctx.operatorId,
      expoToken: "ExponentPushToken[test]",
      customerId: customer.id,
    });
    await testDb.insert(magicLinkOtps).values({
      operatorId: ctx.operatorId,
      email: "demo-customer@test.com",
      otpHash: "hash",
      expiresAt: new Date(Date.now() + 60_000),
    });

    const { POST } = await import("@/app/api/admin/demo/clear-customers/route");
    const res = await POST(postReq());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.tripsReset).toBeGreaterThanOrEqual(1);
    expect(body.customersDeleted).toBe(1);

    const [tripRow] = await testDb.select({ seatsRemaining: trips.seatsRemaining, capacity: trips.capacity }).from(trips).where(eq(trips.id, ctx.tripId));
    expect(tripRow.seatsRemaining).toBe(tripRow.capacity);

    const remainingBookings = await testDb.select().from(bookings).where(eq(bookings.id, bookingId));
    expect(remainingBookings).toHaveLength(0);

    const remainingCustomers = await testDb.select().from(customers).where(eq(customers.operatorId, ctx.operatorId));
    expect(remainingCustomers).toHaveLength(0);

    const remainingTokens = await testDb.select().from(pushTokens).where(eq(pushTokens.operatorId, ctx.operatorId));
    expect(remainingTokens).toHaveLength(0);

    const remainingOtps = await testDb.select().from(magicLinkOtps).where(eq(magicLinkOtps.operatorId, ctx.operatorId));
    expect(remainingOtps).toHaveLength(0);
  });
});
