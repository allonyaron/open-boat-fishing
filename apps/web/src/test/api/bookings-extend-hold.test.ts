import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { NextRequest } from "next/server";
import { seedOperator, cleanupOperator, seedBooking, testDb } from "../db-helpers";
import type { SeedResult } from "../db-helpers";
import { bookings, rateLimits } from "@openboat/db";
import { eq } from "drizzle-orm";

let ctx: SeedResult;

beforeAll(async () => {
  ctx = await seedOperator();
});

afterAll(async () => {
  await cleanupOperator(ctx.operatorId);
});

function req(bookingId: string, opts: { operatorId?: string; ip?: string } = {}) {
  const headers: Record<string, string> = { "x-forwarded-for": opts.ip ?? "10.3.0.1" };
  if (opts.operatorId !== undefined) headers["x-operator-id"] = opts.operatorId;
  else headers["x-operator-id"] = ctx.operatorId;
  return new NextRequest(`http://localhost/api/bookings/${bookingId}/extend-hold`, {
    method: "PATCH",
    headers,
  });
}

async function call(bookingId: string, opts: { operatorId?: string; ip?: string } = {}) {
  const { PATCH } = await import("@/app/api/bookings/[bookingId]/extend-hold/route");
  return PATCH(req(bookingId, opts), { params: Promise.resolve({ bookingId }) });
}

describe("PATCH /api/bookings/[bookingId]/extend-hold", () => {
  it("returns 500 when no operator header is present", async () => {
    const res = await call("00000000-0000-0000-0000-000000000000", { operatorId: "" });
    expect(res.status).toBe(500);
  });

  it("returns 404 for an unknown bookingId", async () => {
    const res = await call("00000000-0000-0000-0000-000000000000", { ip: "10.3.0.2" });
    expect(res.status).toBe(404);
  });

  it("returns 404 for a booking belonging to another operator", async () => {
    const otherCtx = await seedOperator();
    const { bookingId } = await seedBooking(otherCtx, { status: "pending" });
    const res = await call(bookingId, { ip: "10.3.0.3" }); // ctx.operatorId header, wrong operator's booking
    expect(res.status).toBe(404);
    await cleanupOperator(otherCtx.operatorId);
  });

  it("returns 404 for a confirmed (non-pending) booking", async () => {
    const { bookingId } = await seedBooking(ctx, { status: "confirmed" });
    const res = await call(bookingId, { ip: "10.3.0.4" });
    expect(res.status).toBe(404);
  });

  it("returns 409 when the 90-minute hold lifetime has already been reached", async () => {
    const { bookingId } = await seedBooking(ctx, { status: "pending" });
    await testDb
      .update(bookings)
      .set({ createdAt: new Date(Date.now() - 91 * 60 * 1000) })
      .where(eq(bookings.id, bookingId));

    const res = await call(bookingId, { ip: "10.3.0.5" });
    expect(res.status).toBe(409);
  });

  it("extends the hold by 5 minutes from now when the current hold is close to expiring", async () => {
    const { bookingId } = await seedBooking(ctx, {
      status: "pending",
      holdExpiresAt: new Date(Date.now() + 30_000), // 30s from now
    });

    const res = await call(bookingId, { ip: "10.3.0.6" });
    expect(res.status).toBe(200);
    const body = await res.json();
    const newExpiry = new Date(body.holdExpiresAt).getTime();
    const diffMin = (newExpiry - Date.now()) / 60_000;
    expect(diffMin).toBeGreaterThan(4.5);
    expect(diffMin).toBeLessThan(5.5);
  });

  it("caps the extension at 90 minutes from booking creation", async () => {
    const { bookingId } = await seedBooking(ctx, {
      status: "pending",
      holdExpiresAt: new Date(Date.now() + 30_000),
    });
    // createdAt 87 minutes ago — 5-minute extension would overshoot the 90-min cap by 2 min
    await testDb
      .update(bookings)
      .set({ createdAt: new Date(Date.now() - 87 * 60 * 1000) })
      .where(eq(bookings.id, bookingId));

    const res = await call(bookingId, { ip: "10.3.0.7" });
    expect(res.status).toBe(200);
    const body = await res.json();
    const newExpiry = new Date(body.holdExpiresAt).getTime();
    const diffMin = (newExpiry - Date.now()) / 60_000;
    expect(diffMin).toBeGreaterThan(2.5);
    expect(diffMin).toBeLessThan(3.5);
  });

  it("returns 429 on the 11th request from the same IP within 15 minutes", async () => {
    await testDb.delete(rateLimits);
    const { bookingId } = await seedBooking(ctx, { status: "pending" });
    const ip = "10.3.0.8";
    for (let i = 0; i < 10; i++) await call(bookingId, { ip });
    const res = await call(bookingId, { ip });
    expect(res.status).toBe(429);
  });
});
