import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";
import { seedOperator, cleanupOperator, testDb } from "../db-helpers";
import type { SeedResult } from "../db-helpers";
import { vessels } from "@openboat/db";
import { eq } from "drizzle-orm";

vi.mock("@/lib/session", () => ({
  requireAdmin: vi.fn(),
}));

import { requireAdmin } from "@/lib/session";

let ctx: SeedResult;
let otherCtx: SeedResult;

beforeAll(async () => {
  ctx = await seedOperator();
  otherCtx = await seedOperator();
});

afterAll(async () => {
  await cleanupOperator(ctx.operatorId);
  await cleanupOperator(otherCtx.operatorId);
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

function postReq(path: string, body: object) {
  return new NextRequest(`http://localhost${path}`, {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
}

function patchReq(path: string, body: object) {
  return new NextRequest(`http://localhost${path}`, {
    method: "PATCH",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
}

describe("GET /api/admin/settings/vessels", () => {
  it("returns 401 when not authenticated", async () => {
    vi.mocked(requireAdmin).mockResolvedValueOnce(unauthorized());
    const { GET } = await import("@/app/api/admin/settings/vessels/route");
    const res = await GET(getReq("/api/admin/settings/vessels"));
    expect(res.status).toBe(401);
  });

  it("returns 200 with the seeded vessel", async () => {
    const { GET } = await import("@/app/api/admin/settings/vessels/route");
    const res = await GET(getReq("/api/admin/settings/vessels"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
    const found = body.find((v: { id: string }) => v.id === ctx.vesselId);
    expect(found).toBeDefined();
  });
});

describe("POST /api/admin/settings/vessels", () => {
  it("returns 401 when not authenticated", async () => {
    vi.mocked(requireAdmin).mockResolvedValueOnce(unauthorized());
    const { POST } = await import("@/app/api/admin/settings/vessels/route");
    const res = await POST(postReq("/api/admin/settings/vessels", { name: "New Boat", capacity: 10 }));
    expect(res.status).toBe(401);
  });

  it("returns 400 when name is missing", async () => {
    const { POST } = await import("@/app/api/admin/settings/vessels/route");
    const res = await POST(postReq("/api/admin/settings/vessels", { capacity: 10 }));
    expect(res.status).toBe(400);
  });

  it("returns 400 for a non-positive capacity", async () => {
    const { POST } = await import("@/app/api/admin/settings/vessels/route");
    const res = await POST(postReq("/api/admin/settings/vessels", { name: "New Boat", capacity: 0 }));
    expect(res.status).toBe(400);
  });

  it("returns 400 for an invalid hex color", async () => {
    const { POST } = await import("@/app/api/admin/settings/vessels/route");
    const res = await POST(
      postReq("/api/admin/settings/vessels", { name: "New Boat", capacity: 10, color: "blue" }),
    );
    expect(res.status).toBe(400);
  });

  it("returns 201 and creates the vessel with a slugified name and default color", async () => {
    const { POST } = await import("@/app/api/admin/settings/vessels/route");
    const res = await POST(postReq("/api/admin/settings/vessels", { name: "Second Boat!!", capacity: 15 }));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.slug).toBe("second-boat");
    expect(body.color).toBe("#1D4ED8");
    expect(body.capacity).toBe(15);

    const [row] = await testDb.select().from(vessels).where(eq(vessels.id, body.id));
    expect(row.operatorId).toBe(ctx.operatorId);
  });

  it("returns 201 and honors an explicit slug, color, and group discount fields", async () => {
    const { POST } = await import("@/app/api/admin/settings/vessels/route");
    const res = await POST(
      postReq("/api/admin/settings/vessels", {
        name: "Third Boat",
        capacity: 20,
        slug: "custom-slug",
        color: "#00FF00",
        certificateCapacity: 25,
        groupDiscountThreshold: 6,
        groupDiscountPct: 10,
      }),
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.slug).toBe("custom-slug");
    expect(body.color).toBe("#00FF00");
    expect(body.certificateCapacity).toBe(25);
    expect(body.groupDiscountThreshold).toBe(6);
    expect(body.groupDiscountPct).toBe(10);
  });
});

describe("PATCH /api/admin/settings/vessels/[vesselId]", () => {
  it("returns 401 when not authenticated", async () => {
    vi.mocked(requireAdmin).mockResolvedValueOnce(unauthorized());
    const { PATCH } = await import("@/app/api/admin/settings/vessels/[vesselId]/route");
    const res = await PATCH(patchReq(`/api/admin/settings/vessels/${ctx.vesselId}`, { name: "X" }), {
      params: { vesselId: ctx.vesselId },
    });
    expect(res.status).toBe(401);
  });

  it("returns 404 for an unknown vesselId", async () => {
    const { PATCH } = await import("@/app/api/admin/settings/vessels/[vesselId]/route");
    const res = await PATCH(
      patchReq("/api/admin/settings/vessels/00000000-0000-0000-0000-000000000000", { name: "X" }),
      { params: { vesselId: "00000000-0000-0000-0000-000000000000" } },
    );
    expect(res.status).toBe(404);
  });

  it("returns 404 for a vessel belonging to another operator", async () => {
    const { PATCH } = await import("@/app/api/admin/settings/vessels/[vesselId]/route");
    const res = await PATCH(
      patchReq(`/api/admin/settings/vessels/${otherCtx.vesselId}`, { name: "Hijacked" }),
      { params: { vesselId: otherCtx.vesselId } },
    );
    expect(res.status).toBe(404);

    const [row] = await testDb.select({ name: vessels.name }).from(vessels).where(eq(vessels.id, otherCtx.vesselId));
    expect(row.name).not.toBe("Hijacked");
  });

  it("returns 400 for a non-positive capacity", async () => {
    const { PATCH } = await import("@/app/api/admin/settings/vessels/[vesselId]/route");
    const res = await PATCH(patchReq(`/api/admin/settings/vessels/${ctx.vesselId}`, { capacity: 0 }), {
      params: { vesselId: ctx.vesselId },
    });
    expect(res.status).toBe(400);
  });

  it("returns 400 for an invalid hex color", async () => {
    const { PATCH } = await import("@/app/api/admin/settings/vessels/[vesselId]/route");
    const res = await PATCH(patchReq(`/api/admin/settings/vessels/${ctx.vesselId}`, { color: "notacolor" }), {
      params: { vesselId: ctx.vesselId },
    });
    expect(res.status).toBe(400);
  });

  it("returns 200 and updates name and capacity", async () => {
    const { PATCH } = await import("@/app/api/admin/settings/vessels/[vesselId]/route");
    const res = await PATCH(
      patchReq(`/api/admin/settings/vessels/${ctx.vesselId}`, { name: "Renamed Vessel", capacity: 22 }),
      { params: { vesselId: ctx.vesselId } },
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.name).toBe("Renamed Vessel");
    expect(body.capacity).toBe(22);

    const [row] = await testDb.select().from(vessels).where(eq(vessels.id, ctx.vesselId));
    expect(row.name).toBe("Renamed Vessel");
    expect(row.capacity).toBe(22);
  });
});
