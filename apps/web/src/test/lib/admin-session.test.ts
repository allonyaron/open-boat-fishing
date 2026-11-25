import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import { NextRequest, NextResponse } from "next/server";
import { sealData } from "iron-session";
import { eq } from "drizzle-orm";
import { staff } from "@openboat/db";
import { seedOperator, cleanupOperator, testDb } from "../db-helpers";
import type { SeedResult } from "../db-helpers";

// requireAdmin unmocked (row 12, P5-1, F1-8, P5-13): only the cookie jar is
// faked, so the seal, its expiry and the staff re-check are the real ones.
const jar = new Map<string, string>();
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (jar.has(name) ? { name, value: jar.get(name)! } : undefined),
    set: (name: string, value: string) => {
      if (value === "") jar.delete(name);
      else jar.set(name, value);
    },
  }),
}));

import { getSession, requireAdmin } from "@/lib/session";

const SECRET = process.env.SESSION_SECRET!;
let ctx: SeedResult;
let adminId: string;

beforeAll(async () => {
  ctx = await seedOperator();
  const [admin] = await testDb
    .insert(staff)
    .values({
      operatorId: ctx.operatorId,
      name: "Office Admin",
      email: `office-${ctx.operatorId.slice(0, 8)}@test.com`,
      role: "admin",
      passwordHash: "x",
    })
    .returning({ id: staff.id });
  adminId = admin.id;
});

afterAll(async () => {
  await cleanupOperator(ctx.operatorId);
});

beforeEach(async () => {
  jar.clear();
  await testDb.update(staff).set({ active: true, role: "admin", sessionVersion: 0 }).where(eq(staff.id, adminId));
});

afterEach(() => {
  vi.useRealTimers();
});

async function signIn(overrides: Record<string, unknown> = {}, ttl = 60 * 60 * 8) {
  const seal = await sealData(
    {
      staffId: adminId,
      operatorId: ctx.operatorId,
      role: "admin",
      name: "Office Admin",
      sessionVersion: 0,
      ...overrides,
    },
    { password: SECRET, ttl },
  );
  jar.set("openboat_admin", seal);
}

function req(operatorId: string | null = ctx.operatorId) {
  const headers = new Headers();
  if (operatorId) headers.set("x-operator-id", operatorId);
  return new NextRequest("http://localhost/api/admin/today", { headers });
}

async function status(r: NextRequest = req()) {
  const result = await requireAdmin(r);
  return result instanceof NextResponse ? result.status : 200;
}

describe("requireAdmin", () => {
  it("accepts a current admin session and names the admin as the actor", async () => {
    await signIn();
    const result = await requireAdmin(req());
    expect(result).not.toBeInstanceOf(NextResponse);
    if (result instanceof NextResponse) return;
    expect(result.ctx.principal).toEqual({
      kind: "staff",
      staffId: adminId,
      operatorId: ctx.operatorId,
      role: "admin",
    });
    expect(result.ctx.requestId).toBeTruthy();
  });

  it("uses Vercel's request id when the request has one", async () => {
    await signIn();
    const r = req();
    r.headers.set("x-vercel-id", "iad1::abc-123");
    const result = await requireAdmin(r);
    if (result instanceof NextResponse) throw new Error("rejected");
    expect(result.ctx.requestId).toBe("iad1::abc-123");
  });

  it("rejects a session sealed more than 8 hours ago, though the old default allowed 14 days", async () => {
    // Sealed by the app's own session config, so this fails without its ttl.
    const session = await getSession();
    Object.assign(session, {
      staffId: adminId,
      operatorId: ctx.operatorId,
      role: "admin",
      name: "Office Admin",
      sessionVersion: 0,
    });
    await session.save();
    expect(await status()).toBe(200);
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(Date.now() + 8 * 60 * 60 * 1000 + 2 * 60 * 1000);
    expect(await status()).toBe(401);
  });

  it("rejects a session once the admin is deactivated, and clears the cookie", async () => {
    await signIn();
    expect(await status()).toBe(200);
    await testDb.update(staff).set({ active: false }).where(eq(staff.id, adminId));
    expect(await status()).toBe(401);
    expect(jar.has("openboat_admin")).toBe(false);
  });

  it("rejects a session issued before the account's session version went up", async () => {
    await signIn();
    await testDb.update(staff).set({ sessionVersion: 1 }).where(eq(staff.id, adminId));
    expect(await status()).toBe(401);
  });

  it("rejects a session whose account is no longer an admin", async () => {
    await signIn();
    await testDb.update(staff).set({ role: "mate" }).where(eq(staff.id, adminId));
    expect(await status()).toBe(401);
  });

  it("rejects a session for another operator than the host's", async () => {
    await signIn();
    expect(await status(req("00000000-0000-0000-0000-000000000000"))).toBe(401);
  });

  it("rejects a request with no host operator (a missing header is a mismatch)", async () => {
    await signIn();
    expect(await status(req(null))).toBe(401);
  });

  it("rejects a session sealed before session versions existed", async () => {
    await signIn({ sessionVersion: undefined });
    expect(await status()).toBe(401);
  });

  it("rejects a request with no session", async () => {
    expect(await status()).toBe(401);
  });

  it("rejects a session whose staff row is gone", async () => {
    await signIn({ staffId: "00000000-0000-0000-0000-000000000000" });
    expect(await status()).toBe(401);
  });
});
