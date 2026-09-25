import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { NextRequest } from "next/server";
import { seedOperator, cleanupOperator, seedBooking, testDb } from "../db-helpers";
import type { SeedResult } from "../db-helpers";
import { trips, vessels, capacityChanges } from "@openboat/db";
import { eq } from "drizzle-orm";

let ctx: SeedResult;
let otherCtx: SeedResult;
let cancelledTripId: string;

beforeAll(async () => {
  ctx = await seedOperator();
  otherCtx = await seedOperator();

  const [ct] = await testDb
    .insert(trips)
    .values({
      operatorId: ctx.operatorId,
      vesselId: ctx.vesselId,
      productId: ctx.productId,
      departureDate: "2099-01-01",
      startTime: new Date("2099-01-01T07:00:00Z"),
      endTime: new Date("2099-01-01T12:00:00Z"),
      capacity: 20,
      seatsRemaining: 20,
      status: "cancelled",
    })
    .returning({ id: trips.id });
  cancelledTripId = ct.id;
});

afterAll(async () => {
  await cleanupOperator(ctx.operatorId);
  await cleanupOperator(otherCtx.operatorId);
});

function patchReq(tripId: string, body: object, token = ctx.mateToken) {
  return new NextRequest(`http://localhost/api/mate/trips/${tripId}/capacity`, {
    method: "PATCH",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
  });
}

async function callPatch(tripId: string, body: object, token = ctx.mateToken) {
  const { PATCH } = await import("@/app/api/mate/trips/[tripId]/capacity/route");
  return PATCH(patchReq(tripId, body, token), { params: Promise.resolve({ tripId }) });
}

describe("PATCH /api/mate/trips/[tripId]/capacity", () => {
  it("returns 401 without a Bearer token", async () => {
    const { PATCH } = await import("@/app/api/mate/trips/[tripId]/capacity/route");
    const res = await PATCH(
      new NextRequest(`http://localhost/api/mate/trips/${ctx.tripId}/capacity`, {
        method: "PATCH",
        body: JSON.stringify({ capacity: 25 }),
        headers: { "content-type": "application/json" },
      }),
      { params: Promise.resolve({ tripId: ctx.tripId }) },
    );
    expect(res.status).toBe(401);
  });

  it("returns 400 for a non-integer capacity", async () => {
    const res = await callPatch(ctx.tripId, { capacity: "bad" });
    expect(res.status).toBe(400);
  });

  it("returns 400 for a zero capacity", async () => {
    const res = await callPatch(ctx.tripId, { capacity: 0 });
    expect(res.status).toBe(400);
  });

  it("returns 404 for an unknown tripId", async () => {
    const res = await callPatch("00000000-0000-0000-0000-000000000000", { capacity: 25 });
    expect(res.status).toBe(404);
  });

  it("returns 404 for a trip belonging to another operator", async () => {
    const res = await callPatch(otherCtx.tripId, { capacity: 25 });
    expect(res.status).toBe(404);
  });

  it("returns 409 for a cancelled trip", async () => {
    const res = await callPatch(cancelledTripId, { capacity: 25 });
    expect(res.status).toBe(409);
  });

  it("returns 422 when the vessel has no certificateCapacity configured", async () => {
    // ctx.vesselId is seeded without certificateCapacity — default null.
    const res = await callPatch(ctx.tripId, { capacity: 25 });
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.error).toMatch(/certificate capacity/i);
  });

  describe("with certificateCapacity configured", () => {
    beforeAll(async () => {
      await testDb.update(vessels).set({ certificateCapacity: 30 }).where(eq(vessels.id, ctx.vesselId));
    });

    it("returns 422 when the new capacity exceeds certificateCapacity", async () => {
      const res = await callPatch(ctx.tripId, { capacity: 31 });
      expect(res.status).toBe(422);
      const body = await res.json();
      expect(body.error).toMatch(/certificate capacity of 30/i);
    });

    it("returns 422 when the new capacity is below tickets already sold", async () => {
      await seedBooking(ctx, { status: "confirmed" });
      await seedBooking(ctx, { status: "confirmed" });
      const res = await callPatch(ctx.tripId, { capacity: 1 });
      expect(res.status).toBe(422);
      const body = await res.json();
      expect(body.error).toMatch(/tickets already sold/i);
    });

    it("returns 200, adjusts seatsRemaining by the delta, and records a capacityChanges row", async () => {
      const [before] = await testDb
        .select({ capacity: trips.capacity, seatsRemaining: trips.seatsRemaining })
        .from(trips)
        .where(eq(trips.id, ctx.tripId));

      const newCapacity = before.capacity + 4;
      const res = await callPatch(ctx.tripId, { capacity: newCapacity });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.capacity).toBe(newCapacity);
      expect(body.seatsRemaining).toBe(before.seatsRemaining + 4);
      expect(body.certificateCapacity).toBe(30);

      const [change] = await testDb
        .select()
        .from(capacityChanges)
        .where(eq(capacityChanges.tripId, ctx.tripId));
      expect(change.previousCapacity).toBe(before.capacity);
      expect(change.newCapacity).toBe(newCapacity);
      expect(change.staffId).toBe(ctx.staffId);
    });
  });
});
