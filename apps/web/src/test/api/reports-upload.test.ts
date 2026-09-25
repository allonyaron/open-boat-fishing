import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";
import { seedOperator, cleanupOperator } from "../db-helpers";
import type { SeedResult } from "../db-helpers";

vi.mock("@vercel/blob/client", () => ({
  handleUpload: vi.fn(),
}));
vi.mock("@/lib/session", () => ({
  requireAdmin: vi.fn(),
}));

import { handleUpload } from "@vercel/blob/client";
import { requireAdmin } from "@/lib/session";

let ctx: SeedResult;

beforeAll(async () => {
  ctx = await seedOperator();
});

afterAll(async () => {
  await cleanupOperator(ctx.operatorId);
});

beforeEach(() => {
  vi.mocked(handleUpload).mockReset();
  vi.mocked(requireAdmin).mockReset();
});

function req(opts: { mateToken?: string } = {}) {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (opts.mateToken) headers["authorization"] = `Bearer ${opts.mateToken}`;
  return new NextRequest("http://localhost/api/reports/upload", {
    method: "POST",
    body: JSON.stringify({ type: "blob.generate-client-token", payload: {} }),
    headers,
  });
}

describe("POST /api/reports/upload", () => {
  it("returns 401 when neither mate nor admin auth succeeds", async () => {
    vi.mocked(requireAdmin).mockResolvedValue(NextResponse.json({ error: "Unauthorized" }, { status: 401 }));
    const { POST } = await import("@/app/api/reports/upload/route");
    const res = await POST(req());
    expect(res.status).toBe(401);
    expect(handleUpload).not.toHaveBeenCalled();
  });

  it("delegates to handleUpload with the expected content-type/size config when mate auth succeeds", async () => {
    vi.mocked(handleUpload).mockResolvedValue({ type: "blob.generate-client-token" } as any);
    const { POST } = await import("@/app/api/reports/upload/route");
    const res = await POST(req({ mateToken: ctx.mateToken }));
    expect(res.status).toBe(200);
    expect(requireAdmin).not.toHaveBeenCalled();

    const call = vi.mocked(handleUpload).mock.calls[0][0] as any;
    const tokenConfig = await call.onBeforeGenerateToken("reports/some-photo.jpg");
    expect(tokenConfig.allowedContentTypes).toEqual(["image/jpeg", "image/png", "image/webp", "image/heic"]);
    expect(tokenConfig.maximumSizeInBytes).toBe(10 * 1024 * 1024);
  });

  it("delegates to handleUpload when mate auth fails but admin auth succeeds", async () => {
    vi.mocked(requireAdmin).mockResolvedValue({
      session: { staffId: ctx.staffId, operatorId: ctx.operatorId, role: "admin" as const, name: "Admin" },
    } as any);
    vi.mocked(handleUpload).mockResolvedValue({ type: "blob.generate-client-token" } as any);

    const { POST } = await import("@/app/api/reports/upload/route");
    const res = await POST(req());
    expect(res.status).toBe(200);
    expect(handleUpload).toHaveBeenCalled();
  });

  it("returns 400 with the error message when handleUpload throws", async () => {
    vi.mocked(handleUpload).mockRejectedValue(new Error("invalid client token"));
    const { POST } = await import("@/app/api/reports/upload/route");
    const res = await POST(req({ mateToken: ctx.mateToken }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("invalid client token");
  });
});
