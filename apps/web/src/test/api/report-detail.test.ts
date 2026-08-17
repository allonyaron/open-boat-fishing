import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { NextRequest } from "next/server";
import { GET } from "@/app/api/reports/[reportId]/route";
import { seedOperator, cleanupOperator, testDb } from "../db-helpers";
import { fishingReports } from "@openboat/db";

let ctx: Awaited<ReturnType<typeof seedOperator>>;
let reportId: string;

beforeAll(async () => {
  ctx = await seedOperator();
  const [report] = await testDb
    .insert(fishingReports)
    .values({
      operatorId: ctx.operatorId,
      tripId: ctx.tripId,
      vesselId: ctx.vesselId,
      catchSummary: "25 fluke, beautiful day.",
      fishCounts: [{ species: "fluke", count: 25 }],
      photoUrls: [],
    })
    .returning({ id: fishingReports.id });
  reportId = report.id;
});

afterAll(async () => {
  await cleanupOperator(ctx.operatorId);
});

function req(id: string) {
  return new NextRequest(`http://localhost/api/reports/${id}`);
}

async function handle(id: string) {
  return GET(req(id), { params: Promise.resolve({ reportId: id }) });
}

describe("GET /api/reports/[reportId]", () => {
  it("returns the report for a known ID", async () => {
    const res = await handle(reportId);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.id).toBe(reportId);
    expect(body.catchSummary).toBe("25 fluke, beautiful day.");
    expect(body.vesselId).toBe(ctx.vesselId);
    expect(Array.isArray(body.fishCounts)).toBe(true);
  });

  it("returns 404 for an unknown report ID", async () => {
    const res = await handle("00000000-0000-0000-0000-000000000000");
    expect(res.status).toBe(404);
  });
});
