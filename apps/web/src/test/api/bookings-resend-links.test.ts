import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { randomUUID } from "crypto";
import { eq } from "drizzle-orm";
import { bookings, trips } from "@openboat/db";
import { seedOperator, cleanupOperator, seedBooking, testDb } from "../db-helpers";
import type { SeedResult } from "../db-helpers";

const pending: Promise<unknown>[] = [];
vi.mock("@vercel/functions", () => ({ waitUntil: (p: Promise<unknown>) => pending.push(p) }));
vi.mock("@/lib/email", () => ({ sendBookingLinksEmail: vi.fn().mockResolvedValue(undefined) }));

import { sendBookingLinksEmail } from "@/lib/email";
import { POST } from "@/app/api/bookings/resend-links/route";
import { findBookingLinks } from "@/lib/bookings/resend-links";
import { bookingKey, BOOKING_LINK_DAYS_AFTER_TRIP } from "@/lib/bookings/booking-key";

let ctx: SeedResult;
let other: SeedResult;
let ip = 0;
const sent = vi.mocked(sendBookingLinksEmail);

beforeAll(async () => {
  ctx = await seedOperator();
  other = await seedOperator();
});

afterAll(async () => {
  await cleanupOperator(ctx.operatorId);
  await cleanupOperator(other.operatorId);
});

beforeEach(() => {
  sent.mockClear();
  pending.length = 0;
});

async function call(body: unknown, opts: { operatorId?: string; ip?: string } = {}) {
  const req = new NextRequest("http://localhost/api/bookings/resend-links", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-operator-id": opts.operatorId ?? ctx.operatorId,
      "x-forwarded-for": opts.ip ?? `10.77.0.${++ip}`,
    },
    body: JSON.stringify(body),
  });
  const res = await POST(req);
  await Promise.all(pending);
  return res;
}

/** A booking on `on`'s trip, under `email`. */
async function booking(on: SeedResult, email: string, status: "pending" | "confirmed" | "cancelled" = "confirmed") {
  const { bookingId } = await seedBooking(on, { status });
  await testDb.update(bookings).set({ customerEmail: email }).where(eq(bookings.id, bookingId));
  const [row] = await testDb.select({ code: bookings.confirmationCode }).from(bookings).where(eq(bookings.id, bookingId));
  return { bookingId, code: row.code };
}

const address = () => `resend-${randomUUID().slice(0, 8)}@example.com`;

describe("POST /api/bookings/resend-links", () => {
  it("emails the address its confirmed booking's keyed boarding link", async () => {
    const email = address();
    const b = await booking(ctx, email);
    const res = await call({ email });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(sent).toHaveBeenCalledTimes(1);
    const args = sent.mock.calls[0][0];
    expect(args.to).toBe(email);
    expect(args.links).toHaveLength(1);
    expect(args.links[0].confirmationCode).toBe(b.code);
    expect(args.links[0].url).toContain(`/boarding/${b.bookingId}?k=${bookingKey(ctx.operatorId, b.bookingId)}`);
  });

  it("matches the address whatever its case", async () => {
    const email = address();
    await booking(ctx, email);
    await call({ email: `  ${email.toUpperCase()} ` });
    expect(sent).toHaveBeenCalledTimes(1);
    expect(sent.mock.calls[0][0].to).toBe(email);
  });

  it("answers the same, and sends nothing, for an address with no booking", async () => {
    const res = await call({ email: address() });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(sent).not.toHaveBeenCalled();
  });

  it("leaves out pending and cancelled bookings", async () => {
    const email = address();
    await booking(ctx, email, "pending");
    await booking(ctx, email, "cancelled");
    const kept = await booking(ctx, email);
    await call({ email });
    expect(sent.mock.calls[0][0].links.map((l) => l.confirmationCode)).toEqual([kept.code]);
  });

  it("never sends another operator's booking", async () => {
    const email = address();
    await booking(other, email);
    await call({ email });
    expect(sent).not.toHaveBeenCalled();
  });

  it("refuses an invalid address", async () => {
    const res = await call({ email: "not-an-email" });
    expect(res.status).toBe(400);
    expect(sent).not.toHaveBeenCalled();
  });

  it("limits each address to 3 an hour, from any IP", async () => {
    const email = address();
    await booking(ctx, email);
    for (let i = 0; i < 3; i++) expect((await call({ email })).status).toBe(200);
    const res = await call({ email });
    expect(res.status).toBe(429);
    expect(sent).toHaveBeenCalledTimes(3);
  });

  it("limits each IP to 10 in 15 minutes, across addresses", async () => {
    const fixedIp = `10.78.0.${++ip}`;
    for (let i = 0; i < 10; i++) expect((await call({ email: address() }, { ip: fixedIp })).status).toBe(200);
    expect((await call({ email: address() }, { ip: fixedIp })).status).toBe(429);
  });
});

describe("findBookingLinks", () => {
  it("leaves out bookings whose links have stopped opening", async () => {
    const email = address();
    await booking(ctx, email);
    const [trip] = await testDb.select({ endTime: trips.endTime }).from(trips).where(eq(trips.id, ctx.tripId));
    const day = 24 * 60 * 60 * 1000;
    const inside = new Date(trip.endTime.getTime() + BOOKING_LINK_DAYS_AFTER_TRIP * day);
    expect(await findBookingLinks(ctx.operatorId, email, inside)).toHaveLength(1);
    expect(await findBookingLinks(ctx.operatorId, email, new Date(inside.getTime() + 1000))).toHaveLength(0);
  });
});
