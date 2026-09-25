import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";
import { seedOperator, cleanupOperator, testDb } from "../db-helpers";
import type { SeedResult } from "../db-helpers";
import { staff } from "@openboat/db";
import { eq } from "drizzle-orm";
import { randomUUID } from "crypto";

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

describe("GET /api/admin/settings/staff", () => {
  it("returns 401 when not authenticated", async () => {
    vi.mocked(requireAdmin).mockResolvedValueOnce(unauthorized());
    const { GET } = await import("@/app/api/admin/settings/staff/route");
    const res = await GET(getReq("/api/admin/settings/staff"));
    expect(res.status).toBe(401);
  });

  it("returns 200 with the seeded mate, excluding pinHash", async () => {
    const { GET } = await import("@/app/api/admin/settings/staff/route");
    const res = await GET(getReq("/api/admin/settings/staff"));
    expect(res.status).toBe(200);
    const body = await res.json();
    const found = body.find((s: { id: string }) => s.id === ctx.staffId);
    expect(found).toBeDefined();
    expect(found.pinHash).toBeUndefined();
  });
});

describe("POST /api/admin/settings/staff", () => {
  it("returns 401 when not authenticated", async () => {
    vi.mocked(requireAdmin).mockResolvedValueOnce(unauthorized());
    const { POST } = await import("@/app/api/admin/settings/staff/route");
    const res = await POST(
      postReq("/api/admin/settings/staff", { name: "X", email: "x@test.com", role: "mate", pin: "1234" }),
    );
    expect(res.status).toBe(401);
  });

  it("returns 400 when name is missing", async () => {
    const { POST } = await import("@/app/api/admin/settings/staff/route");
    const res = await POST(
      postReq("/api/admin/settings/staff", { email: "x@test.com", role: "mate", pin: "1234" }),
    );
    expect(res.status).toBe(400);
  });

  it("returns 400 for an invalid email", async () => {
    const { POST } = await import("@/app/api/admin/settings/staff/route");
    const res = await POST(
      postReq("/api/admin/settings/staff", { name: "X", email: "not-an-email", role: "mate", pin: "1234" }),
    );
    expect(res.status).toBe(400);
  });

  it("returns 400 for an invalid role", async () => {
    const { POST } = await import("@/app/api/admin/settings/staff/route");
    const res = await POST(
      postReq("/api/admin/settings/staff", { name: "X", email: "x@test.com", role: "owner" }),
    );
    expect(res.status).toBe(400);
  });

  it("returns 400 when an admin password is too short", async () => {
    const { POST } = await import("@/app/api/admin/settings/staff/route");
    const res = await POST(
      postReq("/api/admin/settings/staff", {
        name: "New Admin",
        email: `newadmin-${randomUUID().slice(0, 6)}@test.com`,
        role: "admin",
        password: "short",
      }),
    );
    expect(res.status).toBe(400);
  });

  it("returns 400 when a mate PIN is not 4-8 digits", async () => {
    const { POST } = await import("@/app/api/admin/settings/staff/route");
    const res = await POST(
      postReq("/api/admin/settings/staff", {
        name: "New Mate",
        email: `newmate-${randomUUID().slice(0, 6)}@test.com`,
        role: "mate",
        pin: "12",
      }),
    );
    expect(res.status).toBe(400);
  });

  it("returns 404 when the mate's vesselId belongs to another operator", async () => {
    const { POST } = await import("@/app/api/admin/settings/staff/route");
    const res = await POST(
      postReq("/api/admin/settings/staff", {
        name: "New Mate",
        email: `newmate-${randomUUID().slice(0, 6)}@test.com`,
        role: "mate",
        pin: "1234",
        vesselId: otherCtx.vesselId,
      }),
    );
    expect(res.status).toBe(404);
  });

  it("returns 201 and creates an admin, hashing the password", async () => {
    const email = `newadmin-${randomUUID().slice(0, 6)}@test.com`;
    const { POST } = await import("@/app/api/admin/settings/staff/route");
    const res = await POST(
      postReq("/api/admin/settings/staff", { name: "New Admin", email, role: "admin", password: "longenough1" }),
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.role).toBe("admin");
    expect(body.passwordHash).toBeUndefined();

    const [row] = await testDb.select().from(staff).where(eq(staff.id, body.id));
    expect(row.passwordHash).not.toBeNull();
    expect(row.passwordHash).not.toBe("longenough1");
  });

  it("returns 201 and creates a mate assigned to a vessel", async () => {
    const email = `newmate-${randomUUID().slice(0, 6)}@test.com`;
    const { POST } = await import("@/app/api/admin/settings/staff/route");
    const res = await POST(
      postReq("/api/admin/settings/staff", {
        name: "New Mate",
        email,
        role: "mate",
        pin: "5678",
        vesselId: ctx.vesselId,
      }),
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.role).toBe("mate");
    expect(body.vesselId).toBe(ctx.vesselId);

    const [row] = await testDb.select().from(staff).where(eq(staff.id, body.id));
    expect(row.pinHash).not.toBeNull();
  });
});

describe("PATCH /api/admin/settings/staff/[staffId]", () => {
  it("returns 401 when not authenticated", async () => {
    vi.mocked(requireAdmin).mockResolvedValueOnce(unauthorized());
    const { PATCH } = await import("@/app/api/admin/settings/staff/[staffId]/route");
    const res = await PATCH(patchReq(`/api/admin/settings/staff/${ctx.staffId}`, { name: "X" }), {
      params: { staffId: ctx.staffId },
    });
    expect(res.status).toBe(401);
  });

  it("returns 404 for an unknown staffId", async () => {
    const { PATCH } = await import("@/app/api/admin/settings/staff/[staffId]/route");
    const res = await PATCH(
      patchReq("/api/admin/settings/staff/00000000-0000-0000-0000-000000000000", { name: "X" }),
      { params: { staffId: "00000000-0000-0000-0000-000000000000" } },
    );
    expect(res.status).toBe(404);
  });

  it("returns 404 for a staff member belonging to another operator", async () => {
    const { PATCH } = await import("@/app/api/admin/settings/staff/[staffId]/route");
    const res = await PATCH(
      patchReq(`/api/admin/settings/staff/${otherCtx.staffId}`, { name: "Hijacked" }),
      { params: { staffId: otherCtx.staffId } },
    );
    expect(res.status).toBe(404);
  });

  it("returns 400 when an admin tries to deactivate their own account", async () => {
    const { PATCH } = await import("@/app/api/admin/settings/staff/[staffId]/route");
    const res = await PATCH(patchReq(`/api/admin/settings/staff/${ctx.staffId}`, { active: false }), {
      params: { staffId: ctx.staffId },
    });
    expect(res.status).toBe(400);
  });

  it("returns 404 when reassigning to a vessel from another operator", async () => {
    const { PATCH } = await import("@/app/api/admin/settings/staff/[staffId]/route");
    const res = await PATCH(
      patchReq(`/api/admin/settings/staff/${ctx.staffId}`, { vesselId: otherCtx.vesselId }),
      { params: { staffId: ctx.staffId } },
    );
    expect(res.status).toBe(404);
  });

  it("returns 400 for an invalid PIN reset", async () => {
    const { PATCH } = await import("@/app/api/admin/settings/staff/[staffId]/route");
    const res = await PATCH(patchReq(`/api/admin/settings/staff/${ctx.staffId}`, { pin: "12" }), {
      params: { staffId: ctx.staffId },
    });
    expect(res.status).toBe(400);
  });

  it("returns 200, updates the name, and resets the PIN", async () => {
    const [before] = await testDb.select({ pinHash: staff.pinHash }).from(staff).where(eq(staff.id, ctx.staffId));

    const { PATCH } = await import("@/app/api/admin/settings/staff/[staffId]/route");
    const res = await PATCH(
      patchReq(`/api/admin/settings/staff/${ctx.staffId}`, { name: "Renamed Mate", pin: "9999" }),
      { params: { staffId: ctx.staffId } },
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.name).toBe("Renamed Mate");

    const [after] = await testDb.select({ pinHash: staff.pinHash, name: staff.name }).from(staff).where(eq(staff.id, ctx.staffId));
    expect(after.name).toBe("Renamed Mate");
    expect(after.pinHash).not.toBe(before.pinHash);
  });

  it("clears vesselId when set to null", async () => {
    const { PATCH } = await import("@/app/api/admin/settings/staff/[staffId]/route");
    const res = await PATCH(patchReq(`/api/admin/settings/staff/${ctx.staffId}`, { vesselId: ctx.vesselId }), {
      params: { staffId: ctx.staffId },
    });
    expect(res.status).toBe(200);

    const res2 = await PATCH(patchReq(`/api/admin/settings/staff/${ctx.staffId}`, { vesselId: null }), {
      params: { staffId: ctx.staffId },
    });
    expect(res2.status).toBe(200);
    const body2 = await res2.json();
    expect(body2.vesselId).toBeNull();
  });
});
