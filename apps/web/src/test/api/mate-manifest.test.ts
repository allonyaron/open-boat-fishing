import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { NextRequest } from "next/server";
import { seedOperator, cleanupOperator, seedBooking, testDb } from "../db-helpers";
import type { SeedResult } from "../db-helpers";
import { checkIns } from "@openboat/db";

let ctx: SeedResult;
let otherCtx: SeedResult;

beforeAll(async () => {
  ctx = await seedOperator();
  otherCtx = await seedOperator();
});

afterAll(async () => {
  await cleanupOperator(ctx.operatorId);
  await cleanupOperator(otherCtx.operatorId);
});

function req(params: Record<string, string>, opts: { token?: string; operatorIdHeader?: string } = {}) {
  const url = new URL("http://localhost/api/mate/manifest");
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const headers: Record<string, string> = {};
  if (opts.token !== undefined) headers["authorization"] = `Bearer ${opts.token}`;
  else headers["authorization"] = `Bearer ${ctx.mateToken}`;
  if (opts.operatorIdHeader) headers["x-operator-id"] = opts.operatorIdHeader;
  return new NextRequest(url, { headers });
}

describe("GET /api/mate/manifest", () => {
  it("returns 401 without a Bearer token", async () => {
    const { GET } = await import("@/app/api/mate/manifest/route");
    const res = await GET(new NextRequest(`http://localhost/api/mate/manifest?tripId=${ctx.tripId}`));
    expect(res.status).toBe(401);
  });

  it("returns 401 when the token's operatorId does not match the x-operator-id header", async () => {
    const { GET } = await import("@/app/api/mate/manifest/route");
    const res = await GET(req({ tripId: ctx.tripId }, { operatorIdHeader: otherCtx.operatorId }));
    expect(res.status).toBe(401);
  });

  it("returns 400 when tripId is missing", async () => {
    const { GET } = await import("@/app/api/mate/manifest/route");
    const res = await GET(req({}));
    expect(res.status).toBe(400);
  });

  it("returns 404 for an unknown tripId", async () => {
    const { GET } = await import("@/app/api/mate/manifest/route");
    const res = await GET(req({ tripId: "00000000-0000-0000-0000-000000000000" }));
    expect(res.status).toBe(404);
  });

  it("returns 404 for a trip belonging to another operator", async () => {
    const { GET } = await import("@/app/api/mate/manifest/route");
    const res = await GET(req({ tripId: otherCtx.tripId }));
    expect(res.status).toBe(404);
  });

  it("returns 200 with an empty bookings array when the trip has no bookings", async () => {
    const { GET } = await import("@/app/api/mate/manifest/route");
    const res = await GET(req({ tripId: ctx.tripId }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.trip.id).toBe(ctx.tripId);
    expect(body.bookings).toEqual([]);
  });

  it("returns bookings with tickets, ticketsSold, and check-in status", async () => {
    const { ticketId } = await seedBooking(ctx, { status: "confirmed" });
    await testDb.insert(checkIns).values({
      ticketId,
      tripId: ctx.tripId,
      operatorId: ctx.operatorId,
      staffId: ctx.staffId,
      method: "qr",
    });

    const { GET } = await import("@/app/api/mate/manifest/route");
    const res = await GET(req({ tripId: ctx.tripId }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Number(body.trip.ticketsSold)).toBeGreaterThanOrEqual(1);

    const allTickets = body.bookings.flatMap((b: any) => b.tickets);
    const ticket = allTickets.find((t: any) => t.id === ticketId);
    expect(ticket).toBeDefined();
    expect(ticket.checkedIn).toBe(true);
    expect(ticket.checkInMethod).toBe("qr");
  });
});
