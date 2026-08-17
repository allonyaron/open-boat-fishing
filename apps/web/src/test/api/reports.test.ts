import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { NextRequest } from "next/server";
import { GET } from "@/app/api/reports/route";
import { seedOperator, cleanupOperator, testDb } from "../db-helpers";
import { fishingReports } from "@openboat/db";

let ctx: Awaited<ReturnType<typeof seedOperator>>;

beforeAll(async () => {
  ctx = await seedOperator();

  // Seed one fishing report for the test operator's trip
  await testDb.insert(fishingReports).values({
    operatorId: ctx.operatorId,
    tripId: ctx.tripId,
    vesselId: ctx.vesselId,
    catchSummary: "Great day on the water — 30 sea bass!",
    fishCounts: [{ species: "sea bass", count: 30 }],
    photoUrls: [],
  });
});

afterAll(async () => {
  await cleanupOperator(ctx.operatorId);
});

function req(params: Record<string, string> = {}) {
  const url = new URL("http://localhost/api/reports");
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return new NextRequest(url);
}

describe("GET /api/reports", () => {
  it("returns 200 with items array", async () => {
    const res = await GET(req());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.items)).toBe(true);
    expect("nextCursor" in body).toBe(true);
  });

  it("includes the seeded fishing report", async () => {
    const res = await GET(req());
    const body = await res.json();
    const found = body.items.find(
      (r: { tripId: string }) => r.tripId === ctx.tripId,
    );
    expect(found).toBeDefined();
    expect(found.catchSummary).toBe("Great day on the water — 30 sea bass!");
    expect(found.vesselId).toBe(ctx.vesselId);
  });

  it("filters by vesselId", async () => {
    const res = await GET(req({ vesselId: "00000000-0000-0000-0000-000000000000" }));
    const body = await res.json();
    expect(body.items).toHaveLength(0);
  });

  it("nextCursor is null when results fit in one page", async () => {
    const res = await GET(req());
    const body = await res.json();
    expect(body.nextCursor).toBeNull();
  });
});
