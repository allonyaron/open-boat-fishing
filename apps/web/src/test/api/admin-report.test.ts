import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";
import { seedOperator, cleanupOperator, testDb } from "../db-helpers";
import type { SeedResult } from "../db-helpers";
import { trips, fishingReports } from "@openboat/db";
import { eq } from "drizzle-orm";

vi.mock("@/lib/session", () => ({
  requireAdmin: vi.fn(),
}));

import { requireAdmin } from "@/lib/session";

let ctx: SeedResult;
let sailedTripId: string;

beforeAll(async () => {
  ctx = await seedOperator();

  // Use a far-future date to avoid the (schedule_id, departure_date) unique constraint
  // that would conflict with ctx.trip which is seeded for today.
  const date = "2080-06-15";
  const [st] = await testDb
    .insert(trips)
    .values({
      operatorId: ctx.operatorId,
      scheduleId: ctx.scheduleId,
      vesselId: ctx.vesselId,
      productId: ctx.productId,
      departureDate: date,
      startTime: new Date(`${date}T07:00:00Z`),
      endTime: new Date(`${date}T15:00:00Z`),
      capacity: 20,
      seatsRemaining: 20,
      status: "sailed",
    })
    .returning({ id: trips.id });
  sailedTripId = st.id;
});

afterAll(async () => {
  await cleanupOperator(ctx.operatorId);
});

beforeEach(() => {
  vi.mocked(requireAdmin).mockResolvedValue({
    session: { staffId: ctx.staffId, operatorId: ctx.operatorId, role: "admin" as const, name: "Admin" },
  } as any);
});

function getReq(tripId: string) {
  return new NextRequest(`http://localhost/api/admin/trips/${tripId}/report`);
}

function postReq(tripId: string, body: object = {}) {
  return new NextRequest(`http://localhost/api/admin/trips/${tripId}/report`, {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
}

describe("GET /api/admin/trips/[tripId]/report", () => {
  it("returns 401 when not authenticated", async () => {
    vi.mocked(requireAdmin).mockResolvedValueOnce(
      NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    );
    const { GET } = await import("@/app/api/admin/trips/[tripId]/report/route");
    const res = await GET(getReq(sailedTripId), { params: Promise.resolve({ tripId: sailedTripId }) });
    expect(res.status).toBe(401);
  });

  it("returns 404 when no report exists", async () => {
    const { GET } = await import("@/app/api/admin/trips/[tripId]/report/route");
    const res = await GET(getReq(sailedTripId), { params: Promise.resolve({ tripId: sailedTripId }) });
    expect(res.status).toBe(404);
  });

  it("returns 200 with the report after one is created", async () => {
    await testDb.insert(fishingReports).values({
      operatorId: ctx.operatorId,
      tripId: sailedTripId,
      vesselId: ctx.vesselId,
      staffId: ctx.staffId,
      catchSummary: "Great day on the water",
      fishCounts: [{ species: "fluke", count: 12 }],
      photoUrls: [],
    });

    const { GET } = await import("@/app/api/admin/trips/[tripId]/report/route");
    const res = await GET(getReq(sailedTripId), { params: Promise.resolve({ tripId: sailedTripId }) });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.tripId).toBe(sailedTripId);
    expect(body.catchSummary).toBe("Great day on the water");
  });
});

describe("POST /api/admin/trips/[tripId]/report", () => {
  beforeEach(async () => {
    // Clean up any existing reports on sailedTripId so tests start fresh
    await testDb.delete(fishingReports).where(eq(fishingReports.tripId, sailedTripId));
  });

  it("returns 401 when not authenticated", async () => {
    vi.mocked(requireAdmin).mockResolvedValueOnce(
      NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    );
    const { POST } = await import("@/app/api/admin/trips/[tripId]/report/route");
    const res = await POST(postReq(sailedTripId, { catchSummary: "test" }), {
      params: Promise.resolve({ tripId: sailedTripId }),
    });
    expect(res.status).toBe(401);
  });

  it("returns 404 when tripId does not exist", async () => {
    const fakeId = "00000000-0000-0000-0000-000000000000";
    const { POST } = await import("@/app/api/admin/trips/[tripId]/report/route");
    const res = await POST(postReq(fakeId, { catchSummary: "test" }), {
      params: Promise.resolve({ tripId: fakeId }),
    });
    expect(res.status).toBe(404);
  });

  it("returns 409 when trip has not sailed", async () => {
    const { POST } = await import("@/app/api/admin/trips/[tripId]/report/route");
    const res = await POST(postReq(ctx.tripId, { catchSummary: "test" }), {
      params: Promise.resolve({ tripId: ctx.tripId }),
    });
    expect(res.status).toBe(409);
  });

  it("returns 201 and creates the report", async () => {
    const { POST } = await import("@/app/api/admin/trips/[tripId]/report/route");
    const res = await POST(
      postReq(sailedTripId, {
        catchSummary: "Caught a bunch of fish",
        fishCounts: [{ species: "bass", count: 5 }],
        photoUrls: ["https://example.com/photo.jpg"],
      }),
      { params: Promise.resolve({ tripId: sailedTripId }) },
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.tripId).toBe(sailedTripId);
    expect(body.catchSummary).toBe("Caught a bunch of fish");
    expect(body.fishCounts).toEqual([{ species: "bass", count: 5 }]);
  });

  it("returns 201 and upserts an existing report", async () => {
    const { POST } = await import("@/app/api/admin/trips/[tripId]/report/route");

    // First create
    await POST(postReq(sailedTripId, { catchSummary: "First version" }), {
      params: Promise.resolve({ tripId: sailedTripId }),
    });

    // Then upsert
    const res = await POST(postReq(sailedTripId, { catchSummary: "Updated version" }), {
      params: Promise.resolve({ tripId: sailedTripId }),
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.catchSummary).toBe("Updated version");

    // Only one report row should exist
    const rows = await testDb
      .select()
      .from(fishingReports)
      .where(eq(fishingReports.tripId, sailedTripId));
    expect(rows).toHaveLength(1);
  });
});
