import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";
import { seedOperator, cleanupOperator, seedBooking, testDb } from "../db-helpers";
import type { SeedResult } from "../db-helpers";
import { trips } from "@openboat/db";
import { eq } from "drizzle-orm";

vi.mock("@/lib/session", () => ({
  requireAdmin: vi.fn(),
}));

import { requireAdmin } from "@/lib/session";

let ctx: SeedResult;
let cancelledTripId: string;

beforeAll(async () => {
  ctx = await seedOperator();

  const [ct] = await testDb
    .insert(trips)
    .values({
      operatorId: ctx.operatorId,
      scheduleId: ctx.scheduleId,
      vesselId: ctx.vesselId,
      productId: ctx.productId,
      departureDate: "2099-12-31",
      startTime: new Date("2099-12-31T07:00:00Z"),
      endTime: new Date("2099-12-31T15:00:00Z"),
      capacity: 20,
      seatsRemaining: 0,
      status: "cancelled",
    })
    .returning({ id: trips.id });
  cancelledTripId = ct.id;
});

afterAll(async () => {
  await cleanupOperator(ctx.operatorId);
});

function adminSession() {
  return {
    session: { staffId: ctx.staffId, operatorId: ctx.operatorId, role: "admin" as const, name: "Admin" },
  };
}

function unauthorized() {
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}

beforeEach(() => {
  vi.mocked(requireAdmin).mockResolvedValue(adminSession() as any);
});

function getReq(path: string) {
  return new NextRequest(`http://localhost${path}`);
}

function patchReq(path: string, body: object) {
  return new NextRequest(`http://localhost${path}`, {
    method: "PATCH",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
}

describe("GET /api/admin/trips", () => {
  it("returns 401 when not authenticated", async () => {
    vi.mocked(requireAdmin).mockResolvedValueOnce(unauthorized());
    const { GET } = await import("@/app/api/admin/trips/route");
    const res = await GET(getReq("/api/admin/trips"));
    expect(res.status).toBe(401);
  });

  it("returns 200 with an array of trips", async () => {
    const { GET } = await import("@/app/api/admin/trips/route");
    const res = await GET(getReq(`/api/admin/trips?from=2000-01-01`));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
    const trip = body.find((t: { id: string }) => t.id === ctx.tripId);
    expect(trip).toBeDefined();
    expect(trip).toMatchObject({ id: ctx.tripId, status: "scheduled" });
    expect(trip.vessel).toBeDefined();
    expect(trip.product).toBeDefined();
  });
});

describe("GET /api/admin/trips/[tripId]", () => {
  it("returns 401 when not authenticated", async () => {
    vi.mocked(requireAdmin).mockResolvedValueOnce(unauthorized());
    const { GET } = await import("@/app/api/admin/trips/[tripId]/route");
    const res = await GET(getReq(`/api/admin/trips/${ctx.tripId}`), { params: { tripId: ctx.tripId } });
    expect(res.status).toBe(401);
  });

  it("returns 404 for unknown tripId", async () => {
    const { GET } = await import("@/app/api/admin/trips/[tripId]/route");
    const res = await GET(getReq("/api/admin/trips/00000000-0000-0000-0000-000000000000"), {
      params: { tripId: "00000000-0000-0000-0000-000000000000" },
    });
    expect(res.status).toBe(404);
  });

  it("returns 200 with trip and bookings array", async () => {
    const { GET } = await import("@/app/api/admin/trips/[tripId]/route");
    const res = await GET(getReq(`/api/admin/trips/${ctx.tripId}`), { params: { tripId: ctx.tripId } });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.trip).toMatchObject({ id: ctx.tripId });
    expect(Array.isArray(body.bookings)).toBe(true);
  });
});

describe("PATCH /api/admin/trips/[tripId] — capacity", () => {
  it("returns 401 when not authenticated", async () => {
    vi.mocked(requireAdmin).mockResolvedValueOnce(unauthorized());
    const { PATCH } = await import("@/app/api/admin/trips/[tripId]/route");
    const res = await PATCH(patchReq(`/api/admin/trips/${ctx.tripId}`, { capacity: 25 }), {
      params: { tripId: ctx.tripId },
    });
    expect(res.status).toBe(401);
  });

  it("returns 400 for non-integer capacity", async () => {
    const { PATCH } = await import("@/app/api/admin/trips/[tripId]/route");
    const res = await PATCH(patchReq(`/api/admin/trips/${ctx.tripId}`, { capacity: "bad" }), {
      params: { tripId: ctx.tripId },
    });
    expect(res.status).toBe(400);
  });

  it("returns 409 for a cancelled trip", async () => {
    const { PATCH } = await import("@/app/api/admin/trips/[tripId]/route");
    const res = await PATCH(patchReq(`/api/admin/trips/${cancelledTripId}`, { capacity: 25 }), {
      params: { tripId: cancelledTripId },
    });
    expect(res.status).toBe(409);
  });

  it("returns 422 when capacity is below tickets sold", async () => {
    // Seed 2 tickets so sold=2; then set capacity=1 to trigger the floor check.
    // (capacity=0 would be rejected as invalid before reaching the sold check.)
    await seedBooking(ctx, { status: "pending" });
    await seedBooking(ctx, { status: "pending" });

    const { PATCH } = await import("@/app/api/admin/trips/[tripId]/route");
    const res = await PATCH(patchReq(`/api/admin/trips/${ctx.tripId}`, { capacity: 1 }), {
      params: { tripId: ctx.tripId },
    });
    expect(res.status).toBe(422);
  });

  it("returns 200 and updates capacity correctly", async () => {
    const [before] = await testDb
      .select({ capacity: trips.capacity, seatsRemaining: trips.seatsRemaining })
      .from(trips)
      .where(eq(trips.id, ctx.tripId));

    const newCapacity = before.capacity + 5;
    const { PATCH } = await import("@/app/api/admin/trips/[tripId]/route");
    const res = await PATCH(patchReq(`/api/admin/trips/${ctx.tripId}`, { capacity: newCapacity }), {
      params: { tripId: ctx.tripId },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.capacity).toBe(newCapacity);
    expect(body.seatsRemaining).toBe(before.seatsRemaining + 5);
  });
});
