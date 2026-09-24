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

function postReq(body: object) {
  return new NextRequest("http://localhost/api/admin/settings/schedules", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
}

function patchReq(scheduleId: string, body: object) {
  return new NextRequest(`http://localhost/api/admin/settings/schedules/${scheduleId}`, {
    method: "PATCH",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
}

/** Seeds a fresh 7-day, all-days-of-week pattern via the real POST route so every
 * date in the range gets a trip, regardless of what weekday it falls on. */
async function seedPattern(startDate: string, endDate: string) {
  const { POST } = await import("@/app/api/admin/settings/schedules/route");
  const res = await POST(
    postReq({
      productId: ctx.productId,
      startDate,
      endDate,
      daysOfWeek: ["mon", "tue", "wed", "thu", "fri", "sat", "sun"],
      departureTime: "07:00",
      returnTime: "12:00",
      capacity: 20,
    }),
  );
  const body = await res.json();
  return body.id as string;
}

async function tripsForSchedule(scheduleId: string) {
  return testDb.select().from(trips).where(eq(trips.scheduleId, scheduleId));
}

describe("PATCH /api/admin/settings/schedules/[scheduleId]", () => {
  it("returns 401 when not authenticated", async () => {
    vi.mocked(requireAdmin).mockResolvedValueOnce(
      NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    );
    const { PATCH } = await import("@/app/api/admin/settings/schedules/[scheduleId]/route");
    const res = await PATCH(patchReq(ctx.scheduleId, { active: false }), {
      params: { scheduleId: ctx.scheduleId },
    });
    expect(res.status).toBe(401);
  });

  it("returns 404 for an unknown scheduleId", async () => {
    const { PATCH } = await import("@/app/api/admin/settings/schedules/[scheduleId]/route");
    const res = await PATCH(patchReq("00000000-0000-0000-0000-000000000000", { active: false }), {
      params: { scheduleId: "00000000-0000-0000-0000-000000000000" },
    });
    expect(res.status).toBe(404);
  });

  it("pausing removes all future unbooked trips and sets active=false", async () => {
    const scheduleId = await seedPattern("2098-04-01", "2098-04-07");
    expect((await tripsForSchedule(scheduleId)).length).toBe(7);

    const { PATCH } = await import("@/app/api/admin/settings/schedules/[scheduleId]/route");
    const res = await PATCH(patchReq(scheduleId, { active: false }), { params: { scheduleId } });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.active).toBe(false);
    expect(body.tripsRemoved).toBe(7);
    expect(body.tripsAdded).toBe(0);
    expect(body.tripsKeptBooked).toBe(0);

    expect((await tripsForSchedule(scheduleId)).length).toBe(0);
  });

  it("pausing leaves a booked trip alone and reports it as kept", async () => {
    const scheduleId = await seedPattern("2098-05-01", "2098-05-07");
    const [firstTrip] = await tripsForSchedule(scheduleId);
    const bookedCtx = { ...ctx, tripId: firstTrip.id };
    await seedBooking(bookedCtx, { status: "confirmed" });

    const { PATCH } = await import("@/app/api/admin/settings/schedules/[scheduleId]/route");
    const res = await PATCH(patchReq(scheduleId, { active: false }), { params: { scheduleId } });
    const body = await res.json();
    expect(body.tripsRemoved).toBe(6);
    expect(body.tripsKeptBooked).toBe(1);

    const remaining = await tripsForSchedule(scheduleId);
    expect(remaining.length).toBe(1);
    expect(remaining[0].id).toBe(firstTrip.id);
    expect(remaining[0].status).toBe("scheduled");
  });

  it("resuming a paused pattern re-materializes the missing trips", async () => {
    const scheduleId = await seedPattern("2098-06-01", "2098-06-07");
    const { PATCH } = await import("@/app/api/admin/settings/schedules/[scheduleId]/route");

    await PATCH(patchReq(scheduleId, { active: false }), { params: { scheduleId } });
    expect((await tripsForSchedule(scheduleId)).length).toBe(0);

    const res = await PATCH(patchReq(scheduleId, { active: true }), { params: { scheduleId } });
    const body = await res.json();
    expect(body.active).toBe(true);
    expect(body.tripsAdded).toBe(7);
    expect((await tripsForSchedule(scheduleId)).length).toBe(7);
  });

  it("narrowing the date range removes now-out-of-range unbooked trips only", async () => {
    const scheduleId = await seedPattern("2098-07-01", "2098-07-07");
    const { PATCH } = await import("@/app/api/admin/settings/schedules/[scheduleId]/route");

    const res = await PATCH(patchReq(scheduleId, { endDate: "2098-07-03" }), { params: { scheduleId } });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.tripsRemoved).toBe(4); // 07-04 through 07-07
    expect(body.tripsAdded).toBe(0);

    const remaining = await tripsForSchedule(scheduleId);
    expect(remaining.map((t) => t.departureDate).sort()).toEqual([
      "2098-07-01",
      "2098-07-02",
      "2098-07-03",
    ]);
  });

  it("returns 400 for an invalid date range", async () => {
    const scheduleId = await seedPattern("2098-08-01", "2098-08-07");
    const { PATCH } = await import("@/app/api/admin/settings/schedules/[scheduleId]/route");
    const res = await PATCH(patchReq(scheduleId, { startDate: "2098-08-10", endDate: "2098-08-01" }), {
      params: { scheduleId },
    });
    expect(res.status).toBe(400);
  });
});

describe("GET /api/admin/settings/schedules — tripCount", () => {
  it("reports the number of materialized trips per pattern", async () => {
    const scheduleId = await seedPattern("2098-09-01", "2098-09-07");
    const { GET } = await import("@/app/api/admin/settings/schedules/route");
    const res = await GET(new NextRequest("http://localhost/api/admin/settings/schedules"));
    const body = await res.json();
    const found = body.find((s: { id: string }) => s.id === scheduleId);
    expect(found).toBeDefined();
    expect(found.tripCount).toBe(7);
  });
});
