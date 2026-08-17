import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { NextRequest } from "next/server";
import { GET } from "@/app/api/trips/route";
import { seedOperator, cleanupOperator, testDb } from "../db-helpers";
import { trips } from "@openboat/db";
import { eq } from "drizzle-orm";

let ctx: Awaited<ReturnType<typeof seedOperator>>;
const month = new Date().toISOString().slice(0, 7); // current YYYY-MM

beforeAll(async () => {
  ctx = await seedOperator();
});

afterAll(async () => {
  await cleanupOperator(ctx.operatorId);
});

function req(params: Record<string, string>) {
  const url = new URL("http://localhost/api/trips");
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return new NextRequest(url);
}

describe("GET /api/trips", () => {
  it("returns 400 when month param is missing", async () => {
    const res = await GET(req({}));
    expect(res.status).toBe(400);
  });

  it("returns 400 for malformed month", async () => {
    const res = await GET(req({ month: "2026-8" }));
    expect(res.status).toBe(400);
  });

  it("returns trips for the seeded month", async () => {
    const res = await GET(req({ month }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
    const seeded = body.find((t: { id: string }) => t.id === ctx.tripId);
    expect(seeded).toBeDefined();
    expect(seeded.vessel.id).toBe(ctx.vesselId);
    expect(seeded.product.prices.length).toBeGreaterThan(0);
  });

  it("returns empty array for a month with no trips", async () => {
    const res = await GET(req({ month: "2000-01" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveLength(0);
  });

  it("does not return cancelled trips", async () => {
    await testDb
      .update(trips)
      .set({ status: "cancelled" })
      .where(eq(trips.id, ctx.tripId));

    const res = await GET(req({ month }));
    const body = await res.json();
    const found = body.find((t: { id: string }) => t.id === ctx.tripId);
    expect(found).toBeUndefined();

    // restore
    await testDb
      .update(trips)
      .set({ status: "scheduled" })
      .where(eq(trips.id, ctx.tripId));
  });
});
