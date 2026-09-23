import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";
import { seedOperator, cleanupOperator, seedBooking, cleanupBookings, testDb } from "../db-helpers";
import type { SeedResult } from "../db-helpers";
import { tickets, checkIns } from "@openboat/db";
import { eq } from "drizzle-orm";

vi.mock("@/lib/session", () => ({
  requireAdmin: vi.fn(),
}));

import { requireAdmin } from "@/lib/session";

let ctx: SeedResult;

beforeAll(async () => {
  ctx = await seedOperator();
});

afterAll(async () => {
  await cleanupOperator(ctx.operatorId);
});

beforeEach(() => {
  vi.mocked(requireAdmin).mockResolvedValue({
    session: { staffId: ctx.staffId, operatorId: ctx.operatorId, role: "admin" as const, name: "Admin" },
  } as any);
});

function postReq(tripId: string, body: object) {
  return new NextRequest(`http://localhost/api/admin/trips/${tripId}/checkins`, {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
}

describe("POST /api/admin/trips/[tripId]/checkins", () => {
  // Each test seeds its own booking on the shared ctx.tripId — clean up between
  // tests so tickets/check-ins don't leak into the next one.
  afterEach(async () => {
    await cleanupBookings(ctx.tripId);
  });

  it("returns 401 when not authenticated", async () => {
    vi.mocked(requireAdmin).mockResolvedValueOnce(
      NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    );
    const { POST } = await import("@/app/api/admin/trips/[tripId]/checkins/route");
    const res = await POST(postReq(ctx.tripId, { ticketId: "x", checkedIn: true }), {
      params: { tripId: ctx.tripId },
    });
    expect(res.status).toBe(401);
  });

  it("returns 404 when the ticket doesn't belong to this trip", async () => {
    const { POST } = await import("@/app/api/admin/trips/[tripId]/checkins/route");
    const res = await POST(
      postReq(ctx.tripId, { ticketId: "00000000-0000-0000-0000-000000000000", checkedIn: true }),
      { params: { tripId: ctx.tripId } },
    );
    expect(res.status).toBe(404);
  });

  it("checks a ticket in, then undoes it", async () => {
    const { ticketId } = await seedBooking(ctx, { status: "confirmed" });
    const { POST } = await import("@/app/api/admin/trips/[tripId]/checkins/route");

    const inRes = await POST(postReq(ctx.tripId, { ticketId, checkedIn: true }), {
      params: { tripId: ctx.tripId },
    });
    expect(inRes.status).toBe(200);
    const inBody = await inRes.json();
    expect(inBody.checkedIn).toBe(true);
    expect(inBody.checkedInAt).toBeTruthy();

    const [row] = await testDb.select().from(checkIns).where(eq(checkIns.ticketId, ticketId));
    expect(row).toBeDefined();
    expect(row.method).toBe("manual");
    expect(row.staffId).toBe(ctx.staffId);

    const outRes = await POST(postReq(ctx.tripId, { ticketId, checkedIn: false }), {
      params: { tripId: ctx.tripId },
    });
    expect(outRes.status).toBe(200);
    const outBody = await outRes.json();
    expect(outBody.checkedIn).toBe(false);

    const rowsAfter = await testDb.select().from(checkIns).where(eq(checkIns.ticketId, ticketId));
    expect(rowsAfter.length).toBe(0);
  });

  it("checking in twice is idempotent and returns the original timestamp", async () => {
    const { ticketId } = await seedBooking(ctx, { status: "confirmed" });
    const { POST } = await import("@/app/api/admin/trips/[tripId]/checkins/route");

    const first = await POST(postReq(ctx.tripId, { ticketId, checkedIn: true }), {
      params: { tripId: ctx.tripId },
    });
    const firstBody = await first.json();

    const second = await POST(postReq(ctx.tripId, { ticketId, checkedIn: true }), {
      params: { tripId: ctx.tripId },
    });
    expect(second.status).toBe(200);
    const secondBody = await second.json();
    expect(secondBody.checkedInAt).toBe(firstBody.checkedInAt);
  });

  it("returns 409 when checking in a voided ticket", async () => {
    const { ticketId } = await seedBooking(ctx, { status: "confirmed" });
    await testDb.update(tickets).set({ voided: true }).where(eq(tickets.id, ticketId));

    const { POST } = await import("@/app/api/admin/trips/[tripId]/checkins/route");
    const res = await POST(postReq(ctx.tripId, { ticketId, checkedIn: true }), {
      params: { tripId: ctx.tripId },
    });
    expect(res.status).toBe(409);
  });
});
