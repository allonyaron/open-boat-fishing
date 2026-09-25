import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";
import { createHmac } from "crypto";
import { seedOperator, cleanupOperator, testDb } from "../db-helpers";
import type { SeedResult } from "../db-helpers";
import { operators } from "@openboat/db";
import { eq } from "drizzle-orm";
import { env } from "@/lib/env";

vi.mock("@/lib/session", () => ({
  requireAdmin: vi.fn(),
}));

import { requireAdmin } from "@/lib/session";

let ctx: SeedResult;
const nonce = "test-nonce-abc123";
const validState = createHmac("sha256", env.SESSION_SECRET).update(nonce).digest("hex");

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

afterEach(() => {
  vi.unstubAllGlobals();
});

function req(params: Record<string, string> = {}, opts: { withNonceCookie?: boolean } = { withNonceCookie: true }) {
  const url = new URL("http://localhost/api/stripe/connect/callback");
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const headers: Record<string, string> = {};
  if (opts.withNonceCookie !== false) headers["cookie"] = `stripe_connect_nonce=${nonce}`;
  return new NextRequest(url, { headers });
}

function redirectPath(res: Response) {
  const location = res.headers.get("location")!;
  const url = new URL(location);
  return { path: url.pathname, params: url.searchParams };
}

describe("GET /api/stripe/connect/callback", () => {
  it("returns 401 when not authenticated", async () => {
    vi.mocked(requireAdmin).mockResolvedValueOnce(NextResponse.json({ error: "Unauthorized" }, { status: 401 }));
    const { GET } = await import("@/app/api/stripe/connect/callback/route");
    const res = await GET(req({ state: validState, code: "ac_1" }));
    expect(res.status).toBe(401);
  });

  it("redirects to error when the nonce cookie is missing", async () => {
    const { GET } = await import("@/app/api/stripe/connect/callback/route");
    const res = await GET(req({ state: validState }, { withNonceCookie: false }));
    const { path, params } = redirectPath(res);
    expect(path).toBe("/admin/money");
    expect(params.get("stripe")).toBe("error");
  });

  it("redirects to error when the state param is missing", async () => {
    const { GET } = await import("@/app/api/stripe/connect/callback/route");
    const res = await GET(req({}));
    const { params } = redirectPath(res);
    expect(params.get("stripe")).toBe("error");
  });

  it("redirects to error when the state signature does not match the nonce", async () => {
    const { GET } = await import("@/app/api/stripe/connect/callback/route");
    const res = await GET(req({ state: "0".repeat(validState.length) }));
    const { params } = redirectPath(res);
    expect(params.get("stripe")).toBe("error");
  });

  it("redirects to cancelled when Stripe returns an OAuth error param", async () => {
    const { GET } = await import("@/app/api/stripe/connect/callback/route");
    const res = await GET(req({ state: validState, error: "access_denied", error_description: "user cancelled" }));
    const { path, params } = redirectPath(res);
    expect(path).toBe("/admin/money");
    expect(params.get("stripe")).toBe("cancelled");
  });

  it("redirects to error when code is missing", async () => {
    const { GET } = await import("@/app/api/stripe/connect/callback/route");
    const res = await GET(req({ state: validState }));
    const { params } = redirectPath(res);
    expect(params.get("stripe")).toBe("error");
  });

  it("on a successful token exchange: updates the operator and redirects to connected, clearing the nonce cookie", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ stripe_user_id: "acct_connected_123" }),
      }),
    );

    const { GET } = await import("@/app/api/stripe/connect/callback/route");
    const res = await GET(req({ state: validState, code: "ac_valid" }));
    const { path, params } = redirectPath(res);
    expect(path).toBe("/admin/money");
    expect(params.get("stripe")).toBe("connected");
    expect(res.cookies.get("stripe_connect_nonce")?.value).toBe("");

    const [operator] = await testDb.select().from(operators).where(eq(operators.id, ctx.operatorId));
    expect(operator.stripeAccountId).toBe("acct_connected_123");
    expect(operator.stripeOnboardingComplete).toBe(true);
  });

  it("redirects to error when Stripe's token response is ok but missing stripe_user_id", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) }));
    const { GET } = await import("@/app/api/stripe/connect/callback/route");
    const res = await GET(req({ state: validState, code: "ac_bad" }));
    const { params } = redirectPath(res);
    expect(params.get("stripe")).toBe("error");
  });

  it("redirects to error when Stripe's token response is not ok", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, json: async () => ({ error: "invalid_grant" }) }),
    );
    const { GET } = await import("@/app/api/stripe/connect/callback/route");
    const res = await GET(req({ state: validState, code: "ac_invalid" }));
    const { params } = redirectPath(res);
    expect(params.get("stripe")).toBe("error");
  });

  it("redirects to error when the token exchange fetch throws", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network down")));
    const { GET } = await import("@/app/api/stripe/connect/callback/route");
    const res = await GET(req({ state: validState, code: "ac_throws" }));
    const { params } = redirectPath(res);
    expect(params.get("stripe")).toBe("error");
  });
});
