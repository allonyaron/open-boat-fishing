import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { seedOperator, cleanupOperator } from "../db-helpers";
import type { SeedResult } from "../db-helpers";

vi.mock("@vercel/blob", () => ({
  put: vi.fn(),
}));

import { put } from "@vercel/blob";

let ctx: SeedResult;

beforeAll(async () => {
  ctx = await seedOperator();
});

afterAll(async () => {
  await cleanupOperator(ctx.operatorId);
});

beforeEach(() => {
  vi.mocked(put).mockReset();
});

function req(opts: {
  token?: string;
  contentType?: string;
  contentLength?: number;
  filename?: string;
  body?: string;
}) {
  const headers: Record<string, string> = {};
  if (opts.token !== undefined) headers["authorization"] = `Bearer ${opts.token}`;
  if (opts.contentType) headers["content-type"] = opts.contentType;
  if (opts.contentLength !== undefined) headers["content-length"] = String(opts.contentLength);
  if (opts.filename) headers["x-filename"] = opts.filename;
  return new NextRequest("http://localhost/api/reports/upload-photo", {
    method: "POST",
    headers,
    body: opts.body ?? "fake-image-bytes",
  });
}

describe("POST /api/reports/upload-photo", () => {
  it("returns 401 without a Bearer token", async () => {
    const { POST } = await import("@/app/api/reports/upload-photo/route");
    const res = await POST(req({ contentType: "image/jpeg", contentLength: 10 }));
    expect(res.status).toBe(401);
    expect(put).not.toHaveBeenCalled();
  });

  it("returns 415 for an unsupported content type", async () => {
    const { POST } = await import("@/app/api/reports/upload-photo/route");
    const res = await POST(req({ token: ctx.mateToken, contentType: "application/pdf", contentLength: 10 }));
    expect(res.status).toBe(415);
    expect(put).not.toHaveBeenCalled();
  });

  it("returns 413 when content-length exceeds 10 MB", async () => {
    const { POST } = await import("@/app/api/reports/upload-photo/route");
    const res = await POST(
      req({ token: ctx.mateToken, contentType: "image/jpeg", contentLength: 11 * 1024 * 1024 }),
    );
    expect(res.status).toBe(413);
    expect(put).not.toHaveBeenCalled();
  });

  it("returns 200 with the blob URL and uploads with a sanitized pathname", async () => {
    vi.mocked(put).mockResolvedValue({ url: "https://blob.example/reports/abc.jpg" } as any);
    const { POST } = await import("@/app/api/reports/upload-photo/route");
    const res = await POST(
      req({
        token: ctx.mateToken,
        contentType: "image/jpeg",
        contentLength: 10,
        filename: "my photo!.jpg",
      }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.url).toBe("https://blob.example/reports/abc.jpg");

    const [pathname, , opts] = vi.mocked(put).mock.calls[0];
    expect(pathname).toMatch(/^reports\/\d+-my_photo_\.jpg$/);
    expect(opts).toMatchObject({ access: "public", contentType: "image/jpeg" });
  });

  it("falls back to a generated filename when x-filename is missing", async () => {
    vi.mocked(put).mockResolvedValue({ url: "https://blob.example/reports/xyz.jpg" } as any);
    const { POST } = await import("@/app/api/reports/upload-photo/route");
    const res = await POST(req({ token: ctx.mateToken, contentType: "image/png", contentLength: 10 }));
    expect(res.status).toBe(200);
    const [pathname] = vi.mocked(put).mock.calls[0];
    expect(pathname).toMatch(/^reports\/\d+-photo-\d+\.jpg$/);
  });
});
