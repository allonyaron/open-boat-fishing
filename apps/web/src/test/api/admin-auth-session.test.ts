import { describe, it, expect, vi } from "vitest";

import { NextRequest, NextResponse } from "next/server";

vi.mock("@/lib/session", () => ({
  getSession: vi.fn(),
  requireAdmin: vi.fn(),
}));

import { getSession, requireAdmin } from "@/lib/session";

const meReq = () => new NextRequest("http://localhost/api/admin/auth/me");

describe("GET /api/admin/auth/me", () => {
  it("returns 401 when the session doesn't pass the admin check", async () => {
    vi.mocked(requireAdmin).mockResolvedValue(NextResponse.json({ error: "Unauthorized" }, { status: 401 }));
    const { GET } = await import("@/app/api/admin/auth/me/route");
    const res = await GET(meReq());
    expect(res.status).toBe(401);
  });

  it("returns 200 with staffId, name, and role from the session", async () => {
    vi.mocked(requireAdmin).mockResolvedValue({
      session: { staffId: "staff-1", name: "Admin User", role: "admin" },
    } as any);
    const { GET } = await import("@/app/api/admin/auth/me/route");
    const res = await GET(meReq());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ staffId: "staff-1", name: "Admin User", role: "admin" });
  });
});

describe("POST /api/admin/auth/logout", () => {
  it("destroys the session and returns ok:true", async () => {
    const destroy = vi.fn();
    vi.mocked(getSession).mockResolvedValue({ destroy } as any);
    const { POST } = await import("@/app/api/admin/auth/logout/route");
    const res = await POST();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ ok: true });
    expect(destroy).toHaveBeenCalled();
  });
});
