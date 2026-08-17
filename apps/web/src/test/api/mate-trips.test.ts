import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { NextRequest } from "next/server";
import { GET } from "@/app/api/mate/trips/route";
import { seedOperator, cleanupOperator } from "../db-helpers";

let ctx: Awaited<ReturnType<typeof seedOperator>>;
const today = new Date().toISOString().slice(0, 10);

beforeAll(async () => {
  ctx = await seedOperator();
});

afterAll(async () => {
  await cleanupOperator(ctx.operatorId);
});

function req(params: Record<string, string> = {}, token?: string) {
  const url = new URL("http://localhost/api/mate/trips");
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return new NextRequest(url, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
}

describe("GET /api/mate/trips", () => {
  it("returns 401 without auth", async () => {
    const res = await GET(req({ date: today }));
    expect(res.status).toBe(401);
  });

  it("returns today's trips for the seeded operator", async () => {
    const res = await GET(req({ date: today }, ctx.mateToken));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
    const trip = body.find((t: { id: string }) => t.id === ctx.tripId);
    expect(trip).toBeDefined();
    expect(trip.vessel.id).toBe(ctx.vesselId);
    // postgres.js returns count() as a string; the route types it as number
    expect(Number(trip.ticketsSold)).toBeGreaterThanOrEqual(0);
    expect(Number(trip.checkedIn)).toBeGreaterThanOrEqual(0);
  });

  it("returns empty array for a different date", async () => {
    const res = await GET(req({ date: "2000-01-01" }, ctx.mateToken));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveLength(0);
  });
});
