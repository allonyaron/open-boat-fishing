import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { NextRequest } from "next/server";
import { seedOperator, cleanupOperator, seedBooking, testDb } from "../db-helpers";
import type { SeedResult } from "../db-helpers";
import { trips, bookings } from "@openboat/db";
import { eq } from "drizzle-orm";

let ctx: SeedResult;

beforeAll(async () => {
  ctx = await seedOperator();
});

afterAll(async () => {
  await cleanupOperator(ctx.operatorId);
});

function req(opts: { auth?: string; operatorId?: string } = {}) {
  const headers: Record<string, string> = {};
  headers["Authorization"] = opts.auth ?? `Bearer ${process.env.CRON_SECRET}`;
  if (opts.operatorId !== undefined) headers["x-operator-id"] = opts.operatorId;
  else headers["x-operator-id"] = ctx.operatorId;
  return new NextRequest("http://localhost/api/cron/reset-demo-data", { headers });
}

describe("GET /api/cron/reset-demo-data — DEMO_MODE disabled (default test env)", () => {
  it("returns 401 without a valid CRON_SECRET", async () => {
    const { GET } = await import("@/app/api/cron/reset-demo-data/route");
    const res = await GET(req({ auth: "Bearer wrong-secret" }));
    expect(res.status).toBe(401);
  });

  it("returns 403 when DEMO_MODE is not enabled", async () => {
    const { GET } = await import("@/app/api/cron/reset-demo-data/route");
    const res = await GET(req());
    expect(res.status).toBe(403);
  });
});
