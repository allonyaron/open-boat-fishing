import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { NextRequest } from "next/server";
import { seedOperator, cleanupOperator, testDb } from "../db-helpers";
import type { SeedResult } from "../db-helpers";
import { staff } from "@openboat/db";
import bcrypt from "bcryptjs";

vi.mock("@/lib/session", () => ({
  getSession: vi.fn(),
  requireAdmin: vi.fn(),
}));

import { getSession } from "@/lib/session";

let ctx: SeedResult;
const adminPassword = "TestPass123!";

beforeAll(async () => {
  ctx = await seedOperator();
  const passwordHash = await bcrypt.hash(adminPassword, 10);

  await testDb.insert(staff).values([
    {
      operatorId: ctx.operatorId,
      name: "Test Admin",
      email: "admin@test.local",
      passwordHash,
      role: "admin",
      active: true,
    },
    {
      operatorId: ctx.operatorId,
      name: "Inactive Admin",
      email: "inactive@test.local",
      passwordHash,
      role: "admin",
      active: false,
    },
    {
      operatorId: ctx.operatorId,
      name: "Non Admin",
      email: "nonadmin@test.local",
      passwordHash,
      role: "mate",
      active: true,
    },
  ]);
});

afterAll(async () => {
  await cleanupOperator(ctx.operatorId);
});

function req(body: object, ip: string) {
  return new NextRequest("http://localhost/api/admin/auth/login", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json", "x-forwarded-for": ip },
  });
}

describe("POST /api/admin/auth/login", () => {
  it("returns 400 when fields are missing", async () => {
    const { POST } = await import("@/app/api/admin/auth/login/route");
    const res = await POST(req({ email: "admin@test.local" }, "10.1.0.1"));
    expect(res.status).toBe(400);
  });

  it("returns 401 for unknown email", async () => {
    const { POST } = await import("@/app/api/admin/auth/login/route");
    const res = await POST(req({ email: "nobody@test.local", password: adminPassword }, "10.1.0.2"));
    expect(res.status).toBe(401);
  });

  it("returns 401 for wrong password", async () => {
    const { POST } = await import("@/app/api/admin/auth/login/route");
    const res = await POST(req({ email: "admin@test.local", password: "wrongpass" }, "10.1.0.3"));
    expect(res.status).toBe(401);
  });

  it("returns 403 for non-admin role", async () => {
    const { POST } = await import("@/app/api/admin/auth/login/route");
    const res = await POST(req({ email: "nonadmin@test.local", password: adminPassword }, "10.1.0.4"));
    expect(res.status).toBe(403);
  });

  it("returns 403 for inactive account", async () => {
    const { POST } = await import("@/app/api/admin/auth/login/route");
    const res = await POST(req({ email: "inactive@test.local", password: adminPassword }, "10.1.0.5"));
    expect(res.status).toBe(403);
  });

  it("returns 200 with name and role on valid credentials", async () => {
    const mockSave = vi.fn().mockResolvedValue(undefined);
    vi.mocked(getSession).mockResolvedValue({
      save: mockSave,
      destroy: vi.fn(),
    } as any);

    const { POST } = await import("@/app/api/admin/auth/login/route");
    const res = await POST(req({ email: "admin@test.local", password: adminPassword }, "10.1.0.6"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.name).toBe("Test Admin");
    expect(body.role).toBe("admin");
    expect(mockSave).toHaveBeenCalled();
  });
});
