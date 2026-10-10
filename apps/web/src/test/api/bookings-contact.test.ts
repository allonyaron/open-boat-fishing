import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { NextRequest } from "next/server";
import { seedOperator, seedBooking, cleanupBookings, cleanupOperator, testDb } from "../db-helpers";
import type { SeedResult } from "../db-helpers";
import { bookings, rateLimits } from "@openboat/db";
import { eq } from "drizzle-orm";
import { PATCH } from "@/app/api/bookings/[bookingId]/contact/route";
import { signHoldToken } from "@/lib/bookings/hold-token";

// A payment retry reuses the first attempt's booking (P2-3), so contact
// details fixed after a decline are saved onto the pending booking.

let ctx: SeedResult;
let ipCounter = 0;

const contact = { customerName: "Sal Marino", customerEmail: "Sal@Example.com", customerPhone: "(631) 555-0100" };

// Carries a valid hold token for ctx's operator unless token is null.
function call(bookingId: string, body: unknown = contact, token?: string | null) {
  const holdToken = token === undefined ? signHoldToken({ bookingId, operatorId: ctx.operatorId }) : token;
  const req = new NextRequest(`http://localhost/api/bookings/${bookingId}/contact`, {
    method: "PATCH",
    body: JSON.stringify(body),
    headers: {
      "Content-Type": "application/json",
      "x-operator-id": ctx.operatorId,
      ...(holdToken ? { "x-hold-token": holdToken } : {}),
      "x-forwarded-for": `10.42.0.${++ipCounter}`,
    },
  });
  return PATCH(req, { params: Promise.resolve({ bookingId }) });
}

async function row(bookingId: string) {
  const [b] = await testDb.select().from(bookings).where(eq(bookings.id, bookingId));
  return b;
}

const LIVE = () => new Date(Date.now() + 10 * 60_000);

beforeAll(async () => {
  ctx = await seedOperator();
});

afterAll(async () => {
  await cleanupBookings(ctx.tripId);
  await cleanupOperator(ctx.operatorId);
});

describe("PATCH /api/bookings/:id/contact (P2-3)", () => {
  it("saves the contact details on a live pending booking", async () => {
    const { bookingId } = await seedBooking(ctx, { status: "pending", holdExpiresAt: LIVE() });

    const res = await call(bookingId);

    expect(res.status).toBe(200);
    const b = await row(bookingId);
    expect(b.customerEmail).toBe("sal@example.com");
    expect(b.customerName).toBe("Sal Marino");
    expect(b.customerPhone).toBe("(631) 555-0100");
  });

  it("returns 401 without a hold token, and changes nothing", async () => {
    const { bookingId } = await seedBooking(ctx, { status: "pending", holdExpiresAt: LIVE() });
    const before = await row(bookingId);

    const res = await call(bookingId, contact, null);

    expect(res.status).toBe(401);
    expect((await row(bookingId)).customerEmail).toBe(before.customerEmail);
  });

  it("returns 401 with a token for another booking", async () => {
    const { bookingId } = await seedBooking(ctx, { status: "pending", holdExpiresAt: LIVE() });
    const other = await seedBooking(ctx, { status: "pending", holdExpiresAt: LIVE() });
    const before = await row(bookingId);

    const res = await call(bookingId, contact, signHoldToken({ bookingId: other.bookingId, operatorId: ctx.operatorId }));

    expect(res.status).toBe(401);
    expect((await row(bookingId)).customerEmail).toBe(before.customerEmail);
  });

  it("returns 404 once the hold has expired", async () => {
    const { bookingId } = await seedBooking(ctx, { status: "pending", holdExpiresAt: new Date(Date.now() - 1000) });
    const before = await row(bookingId);

    const res = await call(bookingId);

    expect(res.status).toBe(404);
    expect((await row(bookingId)).customerEmail).toBe(before.customerEmail);
  });

  it.each(["confirmed", "cancelled"] as const)("returns 404 for a %s booking", async (status) => {
    const { bookingId } = await seedBooking(ctx, { status, holdExpiresAt: LIVE() });
    const before = await row(bookingId);

    const res = await call(bookingId);

    expect(res.status).toBe(404);
    expect((await row(bookingId)).customerEmail).toBe(before.customerEmail);
  });

  it("returns 404 for another operator's booking", async () => {
    const other = await seedOperator();
    try {
      const { bookingId } = await seedBooking(other, { status: "pending", holdExpiresAt: LIVE() });
      const before = await row(bookingId);
      const res = await call(bookingId);
      expect(res.status).toBe(404);
      expect((await row(bookingId)).customerEmail).toBe(before.customerEmail);
    } finally {
      await cleanupBookings(other.tripId);
      await cleanupOperator(other.operatorId);
    }
  });

  it("returns 400 for an invalid email", async () => {
    const { bookingId } = await seedBooking(ctx, { status: "pending", holdExpiresAt: LIVE() });
    const res = await call(bookingId, { ...contact, customerEmail: "nope" });
    expect(res.status).toBe(400);
  });

  it("returns 404 for a malformed id", async () => {
    const res = await call("not-a-uuid");
    expect(res.status).toBe(404);
  });

  it("returns 429 on the 11th request for the same booking within 15 minutes", async () => {
    await testDb.delete(rateLimits);
    const { bookingId } = await seedBooking(ctx, { status: "pending", holdExpiresAt: LIVE() });
    for (let i = 0; i < 10; i++) expect((await call(bookingId)).status).toBe(200);
    const res = await call(bookingId);
    expect(res.status).toBe(429);
  });
});
