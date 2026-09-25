import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { NextRequest } from "next/server";
import { seedOperator, cleanupOperator, testDb } from "../db-helpers";
import type { SeedResult } from "../db-helpers";
import { bookings, bookingItems, tickets } from "@openboat/db";
import { randomUUID } from "crypto";
import { signCustomerToken } from "@/lib/customer-auth";

let ctx: SeedResult;
let otherCtx: SeedResult;
let email: string;
let token: string;

async function seedBookingFor(operatorId: string, tripId: string, customerEmail: string) {
  const [booking] = await testDb
    .insert(bookings)
    .values({
      operatorId,
      confirmationCode: randomUUID().slice(0, 6).toUpperCase(),
      status: "confirmed",
      totalCents: 10000,
      platformFeeCents: 150,
      customerEmail,
      holdExpiresAt: new Date(Date.now() + 3_600_000),
    })
    .returning({ id: bookings.id });

  const [item] = await testDb
    .insert(bookingItems)
    .values({ bookingId: booking.id, tripId, operatorId, subtotalCents: 10000 })
    .returning({ id: bookingItems.id });

  await testDb.insert(tickets).values({
    bookingItemId: item.id,
    bookingId: booking.id,
    operatorId,
    ticketType: "adult",
    priceCents: 10000,
    feeAmountCents: 150,
    qrPayload: randomUUID(),
  });

  return booking.id;
}

beforeAll(async () => {
  ctx = await seedOperator();
  otherCtx = await seedOperator();
  email = `account-${randomUUID().slice(0, 6)}@test.com`;
  token = signCustomerToken({
    customerId: randomUUID(),
    operatorId: ctx.operatorId,
    email,
    name: "Test Customer",
  });
});

afterAll(async () => {
  await cleanupOperator(ctx.operatorId);
  await cleanupOperator(otherCtx.operatorId);
});

function req(opts: { auth?: string } = {}) {
  const headers: Record<string, string> = {};
  headers["authorization"] = opts.auth !== undefined ? opts.auth : `Bearer ${token}`;
  return new NextRequest("http://localhost/api/account/bookings", { headers });
}

describe("GET /api/account/bookings", () => {
  it("returns 401 without a Bearer token", async () => {
    const { GET } = await import("@/app/api/account/bookings/route");
    const res = await GET(req({ auth: "" }));
    expect(res.status).toBe(401);
  });

  it("returns an empty array when the customer has no bookings", async () => {
    const { GET } = await import("@/app/api/account/bookings/route");
    const res = await GET(req());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual([]);
  });

  it("returns the customer's booking with nested items and tickets", async () => {
    const bookingId = await seedBookingFor(ctx.operatorId, ctx.tripId, email);
    const { GET } = await import("@/app/api/account/bookings/route");
    const res = await GET(req());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveLength(1);
    expect(body[0].id).toBe(bookingId);
    expect(body[0].items).toHaveLength(1);
    expect(body[0].items[0].tickets).toHaveLength(1);
    expect(body[0].items[0].tickets[0].ticketType).toBe("adult");
  });

  it("does not include another customer's booking on the same operator", async () => {
    await seedBookingFor(ctx.operatorId, ctx.tripId, `other-${randomUUID().slice(0, 6)}@test.com`);
    const { GET } = await import("@/app/api/account/bookings/route");
    const res = await GET(req());
    const body = await res.json();
    // Only the one booking seeded for `email` in the previous test — the
    // other-email booking must not appear.
    expect(body).toHaveLength(1);
  });

  it("does not include a same-email booking from a different operator", async () => {
    await seedBookingFor(otherCtx.operatorId, otherCtx.tripId, email);
    const { GET } = await import("@/app/api/account/bookings/route");
    const res = await GET(req());
    const body = await res.json();
    expect(body).toHaveLength(1); // still only the ctx.operatorId booking
  });
});
