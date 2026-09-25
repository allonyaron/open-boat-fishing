import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { NextRequest } from "next/server";
import { seedOperator, cleanupOperator, testDb } from "../db-helpers";
import type { SeedResult } from "../db-helpers";
import { trips, fishingReports } from "@openboat/db";
import { eq } from "drizzle-orm";

let ctx: SeedResult;
let sailedTripId: string;

beforeAll(async () => {
  ctx = await seedOperator();

  const date = "2081-06-15";
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

function getReq(tripId: string, token = ctx.mateToken) {
  return new NextRequest(`http://localhost/api/mate/trips/${tripId}/report`, {
    headers: token ? { authorization: `Bearer ${token}` } : {},
  });
}

function postReq(tripId: string, body: object, token = ctx.mateToken) {
  return new NextRequest(`http://localhost/api/mate/trips/${tripId}/report`, {
    method: "POST",
    body: JSON.stringify(body),
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
  });
}

async function callGet(tripId: string, token = ctx.mateToken) {
  const { GET } = await import("@/app/api/mate/trips/[tripId]/report/route");
  return GET(getReq(tripId, token), { params: Promise.resolve({ tripId }) });
}

async function callPost(tripId: string, body: object, token = ctx.mateToken) {
  const { POST } = await import("@/app/api/mate/trips/[tripId]/report/route");
  return POST(postReq(tripId, body, token), { params: Promise.resolve({ tripId }) });
}

describe("GET /api/mate/trips/[tripId]/report", () => {
  it("returns 401 without a Bearer token", async () => {
    const res = await callGet(sailedTripId, "");
    expect(res.status).toBe(401);
  });

  it("returns 404 when no report exists", async () => {
    const res = await callGet(sailedTripId);
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

    const res = await callGet(sailedTripId);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.tripId).toBe(sailedTripId);
    expect(body.catchSummary).toBe("Great day on the water");

    await testDb.delete(fishingReports).where(eq(fishingReports.tripId, sailedTripId));
  });
});

describe("POST /api/mate/trips/[tripId]/report", () => {
  it("returns 401 without a Bearer token", async () => {
    const res = await callPost(sailedTripId, { catchSummary: "test" }, "");
    expect(res.status).toBe(401);
  });

  it("returns 400 for a catchSummary over 2000 chars", async () => {
    const res = await callPost(sailedTripId, { catchSummary: "x".repeat(2001) });
    expect(res.status).toBe(400);
  });

  it("returns 400 when fishCounts is not an array", async () => {
    const res = await callPost(sailedTripId, { fishCounts: "not-an-array" });
    expect(res.status).toBe(400);
  });

  it("returns 400 for a fishCounts entry with an invalid species", async () => {
    const res = await callPost(sailedTripId, { fishCounts: [{ species: "", count: 1 }] });
    expect(res.status).toBe(400);
  });

  it("returns 400 for a fishCounts entry with a negative count", async () => {
    const res = await callPost(sailedTripId, { fishCounts: [{ species: "fluke", count: -1 }] });
    expect(res.status).toBe(400);
  });

  it("returns 400 for a photoUrls entry that is not a string", async () => {
    const res = await callPost(sailedTripId, { photoUrls: [123] });
    expect(res.status).toBe(400);
  });

  it("returns 404 when tripId does not exist", async () => {
    const res = await callPost("00000000-0000-0000-0000-000000000000", { catchSummary: "test" });
    expect(res.status).toBe(404);
  });

  it("returns 409 when the trip has not sailed", async () => {
    const res = await callPost(ctx.tripId, { catchSummary: "test" });
    expect(res.status).toBe(409);
  });

  it("returns 201 and creates the report", async () => {
    const res = await callPost(sailedTripId, {
      catchSummary: "Caught a bunch of fish",
      fishCounts: [{ species: "bass", count: 5 }],
      photoUrls: ["https://example.com/photo.jpg"],
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.tripId).toBe(sailedTripId);
    expect(body.catchSummary).toBe("Caught a bunch of fish");
    expect(body.staffId).toBe(ctx.staffId);
  });

  it("returns 201 and upserts an existing report without duplicating the row", async () => {
    await callPost(sailedTripId, { catchSummary: "First version" });
    const res = await callPost(sailedTripId, { catchSummary: "Updated version" });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.catchSummary).toBe("Updated version");

    const rows = await testDb.select().from(fishingReports).where(eq(fishingReports.tripId, sailedTripId));
    expect(rows).toHaveLength(1);
  });
});
