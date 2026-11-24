import { describe, it, expect, vi, beforeAll, beforeEach, afterAll } from "vitest";
import { NextRequest } from "next/server";
import { and, eq } from "drizzle-orm";
import { auditLog, platformUsers, rateLimits } from "@openboat/db";
import { testDb } from "../db-helpers";

// Named platform accounts (row 12, AR-9), unmocked except for the cookie jar
// and PLATFORM_SECRET, which the tests change to show it signs everyone out.
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
vi.mock("@/lib/env", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/env")>();
  return { env: { ...actual.env, PLATFORM_SECRET: "first-platform-secret-0123456789abcdef" } };
});

import { env } from "@/lib/env";
import { POST as signIn, DELETE as signOut } from "@/app/api/platform/auth/route";
import { POST as setup } from "@/app/api/platform/auth/setup/route";
import { GET as me } from "@/app/api/platform/me/route";
import { GET as listUsers, POST as addUser } from "@/app/api/platform/users/route";
import { PATCH as patchUser } from "@/app/api/platform/users/[userId]/route";

const SECRET = "first-platform-secret-0123456789abcdef";
let ip = 0;

function req(path: string, method = "GET", body?: unknown) {
  return new NextRequest(`http://localhost${path}`, {
    method,
    ...(body !== undefined && { body: JSON.stringify(body) }),
    headers: { "content-type": "application/json", "x-forwarded-for": `10.9.0.${++ip}` },
  });
}

async function whoAmI() {
  const res = await me(req("/api/platform/me"));
  return { status: res.status, body: await res.json() };
}

const first = { name: "Ada", email: "ada@platform.test", password: "correct-horse-1" };

async function cleanup() {
  await testDb.delete(auditLog).where(eq(auditLog.targetTable, "platform_users"));
  await testDb.delete(platformUsers);
}

beforeAll(cleanup);
afterAll(cleanup);
beforeEach(async () => {
  jar.clear();
  env.PLATFORM_SECRET = SECRET;
  await testDb.delete(rateLimits);
});

describe("platform accounts", () => {
  it("asks for the first account while none exists", async () => {
    expect(await whoAmI()).toEqual({
      status: 401,
      body: { error: "Unauthorized", configured: true, needsFirstAccount: true },
    });
  });

  it("refuses to create the first account with the wrong secret", async () => {
    const res = await setup(req("/api/platform/auth/setup", "POST", { ...first, secret: "not-the-secret" }));
    expect(res.status).toBe(401);
    expect(await testDb.select().from(platformUsers)).toHaveLength(0);
  });

  it("creates the first account with the secret, signs it in, and records who", async () => {
    const res = await setup(req("/api/platform/auth/setup", "POST", { ...first, secret: SECRET }));
    expect(res.status).toBe(201);

    const { status, body } = await whoAmI();
    expect(status).toBe(200);
    expect(body).toMatchObject({ name: "Ada", email: "ada@platform.test" });

    const [row] = await testDb
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.action, "platform_user.create"), eq(auditLog.targetId, body.id)));
    expect(row).toMatchObject({ actorKind: "platform", actorId: body.id, operatorId: null });
    expect(row.after).toEqual({ name: "Ada", email: "ada@platform.test", active: true });
    expect(JSON.stringify(row)).not.toContain("correct-horse");
  });

  it("closes setup once an account exists, even with the secret", async () => {
    const res = await setup(
      req("/api/platform/auth/setup", "POST", { name: "Eve", email: "eve@x.test", password: "another-pass-1", secret: SECRET }),
    );
    expect(res.status).toBe(409);
    expect((await whoAmI()).body.needsFirstAccount).toBe(false);
  });

  it("signs in with email and password only", async () => {
    expect((await signIn(req("/api/platform/auth", "POST", { email: first.email, password: "wrong-password" }))).status).toBe(401);
    expect((await signIn(req("/api/platform/auth", "POST", { email: "nobody@x.test", password: "whatever-1" }))).status).toBe(401);
    expect((await signIn(req("/api/platform/auth", "POST", { secret: SECRET }))).status).toBe(400);
    const res = await signIn(req("/api/platform/auth", "POST", { email: "ADA@platform.test ", password: first.password }));
    expect(res.status).toBe(200);
    expect((await whoAmI()).status).toBe(200);

    await signOut(req("/api/platform/auth", "DELETE"));
    expect((await whoAmI()).status).toBe(401);
  });

  it("signs everyone out when PLATFORM_SECRET changes", async () => {
    await signIn(req("/api/platform/auth", "POST", { email: first.email, password: first.password }));
    expect((await whoAmI()).status).toBe(200);
    env.PLATFORM_SECRET = "rotated-platform-secret-0123456789abcdef";
    expect((await whoAmI()).status).toBe(401);
    // Signing in again under the new secret works.
    await signIn(req("/api/platform/auth", "POST", { email: first.email, password: first.password }));
    expect((await whoAmI()).status).toBe(200);
  });

  it("turns the console off when PLATFORM_SECRET is unset", async () => {
    await signIn(req("/api/platform/auth", "POST", { email: first.email, password: first.password }));
    env.PLATFORM_SECRET = undefined;
    expect(await whoAmI()).toEqual({
      status: 401,
      body: { error: "Unauthorized", configured: false, needsFirstAccount: false },
    });
    expect((await signIn(req("/api/platform/auth", "POST", { email: first.email, password: first.password }))).status).toBe(500);
  });

  it("adds a person, and deactivating them ends their session", async () => {
    await signIn(req("/api/platform/auth", "POST", { email: first.email, password: first.password }));
    const adaCookie = jar.get("openboat_platform")!;
    const ada = (await whoAmI()).body;

    const added = await addUser(req("/api/platform/users", "POST", { name: "Bob", email: "bob@platform.test", password: "bobs-password" }));
    expect(added.status).toBe(201);
    const bob = await added.json();
    expect(bob).not.toHaveProperty("passwordHash");
    const dup = await addUser(req("/api/platform/users", "POST", { name: "Bob 2", email: "bob@platform.test", password: "bobs-password" }));
    expect(dup.status).toBe(409);

    const [created] = await testDb
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.action, "platform_user.create"), eq(auditLog.targetId, bob.id)));
    expect(created).toMatchObject({ actorKind: "platform", actorId: ada.id });

    // Bob signs in on his own browser.
    jar.clear();
    await signIn(req("/api/platform/auth", "POST", { email: "bob@platform.test", password: "bobs-password" }));
    const bobCookie = jar.get("openboat_platform")!;
    expect((await whoAmI()).body.id).toBe(bob.id);

    // Ada deactivates him.
    jar.set("openboat_platform", adaCookie);
    const off = await patchUser(req(`/api/platform/users/${bob.id}`, "PATCH", { active: false }), { params: { userId: bob.id } });
    expect(off.status).toBe(200);
    expect((await off.json()).active).toBe(false);

    jar.set("openboat_platform", bobCookie);
    expect((await whoAmI()).status).toBe(401);
    expect((await signIn(req("/api/platform/auth", "POST", { email: "bob@platform.test", password: "bobs-password" }))).status).toBe(403);

    const [update] = await testDb
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.action, "platform_user.update"), eq(auditLog.targetId, bob.id)));
    expect(update).toMatchObject({ actorId: ada.id, before: { active: true }, after: { active: false } });

    jar.set("openboat_platform", adaCookie);
    const list = await (await listUsers(req("/api/platform/users"))).json();
    expect(list.map((u: { email: string }) => u.email)).toEqual(["ada@platform.test", "bob@platform.test"]);
  });

  it("won't let a user deactivate themselves, and keeps them signed in when they set their own password", async () => {
    await signIn(req("/api/platform/auth", "POST", { email: first.email, password: first.password }));
    const ada = (await whoAmI()).body;
    const self = await patchUser(req(`/api/platform/users/${ada.id}`, "PATCH", { active: false }), { params: { userId: ada.id } });
    expect(self.status).toBe(400);

    const pw = await patchUser(req(`/api/platform/users/${ada.id}`, "PATCH", { password: "a-new-password" }), { params: { userId: ada.id } });
    expect(pw.status).toBe(200);
    expect((await whoAmI()).status).toBe(200);

    const [update] = await testDb
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.action, "platform_user.update"), eq(auditLog.targetId, ada.id)));
    expect(update.before).toEqual({ passwordHash: "[secret]" });
    expect(update.after).toEqual({ passwordHash: "[secret]" });
  });
});
