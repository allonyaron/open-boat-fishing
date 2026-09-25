import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { NextRequest } from "next/server";
import { seedOperator, cleanupOperator, testDb } from "../db-helpers";
import type { SeedResult } from "../db-helpers";
import { bookings, bookingItems, operators } from "@openboat/db";
import { eq } from "drizzle-orm";
import { randomUUID } from "crypto";

let ctx: SeedResult;
let confirmationCode: string;

beforeAll(async () => {
  ctx = await seedOperator();
  confirmationCode = randomUUID().slice(0, 6).toUpperCase();
  const [booking] = await testDb
    .insert(bookings)
    .values({
      operatorId: ctx.operatorId,
      confirmationCode,
      status: "confirmed",
      totalCents: 10000,
      platformFeeCents: 150,
      customerEmail: "calendar@test.com",
      holdExpiresAt: new Date(Date.now() + 3_600_000),
    })
    .returning({ id: bookings.id });

  await testDb.insert(bookingItems).values({
    bookingId: booking.id,
    tripId: ctx.tripId,
    operatorId: ctx.operatorId,
    subtotalCents: 10000,
  });
});

afterAll(async () => {
  await cleanupOperator(ctx.operatorId);
});

function req(code: string, operatorId?: string) {
  const headers: Record<string, string> = {};
  if (operatorId !== undefined) headers["x-operator-id"] = operatorId;
  return new NextRequest(`http://localhost/api/bookings/confirmation/${code}/calendar`, { headers });
}

async function call(code: string, operatorId?: string) {
  const { GET } = await import("@/app/api/bookings/confirmation/[code]/calendar/route");
  return GET(req(code, operatorId), { params: { code } });
}

describe("GET /api/bookings/confirmation/[code]/calendar", () => {
  it("returns 404 when there is no operator header", async () => {
    const res = await call(confirmationCode, undefined);
    expect(res.status).toBe(404);
  });

  it("returns 404 for an operator header that doesn't match any operator", async () => {
    const res = await call(confirmationCode, "00000000-0000-0000-0000-000000000000");
    expect(res.status).toBe(404);
  });

  it("returns 404 for an unknown confirmation code", async () => {
    const res = await call("ZZZZZZ", ctx.operatorId);
    expect(res.status).toBe(404);
  });

  it("returns 404 when the booking has no trips", async () => {
    const code = randomUUID().slice(0, 6).toUpperCase();
    await testDb.insert(bookings).values({
      operatorId: ctx.operatorId,
      confirmationCode: code,
      status: "confirmed",
      totalCents: 10000,
      platformFeeCents: 150,
      customerEmail: "no-trips@test.com",
      holdExpiresAt: new Date(Date.now() + 3_600_000),
    });
    const res = await call(code, ctx.operatorId);
    expect(res.status).toBe(404);
  });

  it("returns a valid ICS payload with the correct headers", async () => {
    const res = await call(confirmationCode, ctx.operatorId);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/calendar; charset=utf-8");
    expect(res.headers.get("content-disposition")).toBe(
      `attachment; filename="trip-${confirmationCode}.ics"`,
    );

    const text = await res.text();
    expect(text).toContain("BEGIN:VCALENDAR");
    expect(text).toContain("BEGIN:VEVENT");
    expect(text).toContain(`DESCRIPTION:Booking confirmation: ${confirmationCode}`);
    expect(text).toMatch(/DTSTART:\d{8}T\d{6}Z/);
  });

  it("falls back to the operator's name for LOCATION when dockAddress is not set", async () => {
    const [op] = await testDb.select({ name: operators.name, dockAddress: operators.dockAddress }).from(operators).where(eq(operators.id, ctx.operatorId));
    expect(op.dockAddress).toBeNull();

    const res = await call(confirmationCode, ctx.operatorId);
    const text = await res.text();
    expect(text).toContain(`LOCATION:${op.name}`);
  });
});
