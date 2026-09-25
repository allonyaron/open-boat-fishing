import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { NextRequest } from "next/server";
import { seedOperator, cleanupOperator, testDb } from "../db-helpers";
import type { SeedResult } from "../db-helpers";
import { customers, pushTokens } from "@openboat/db";
import { and, eq } from "drizzle-orm";
import { randomUUID } from "crypto";
import { signCustomerToken } from "@/lib/customer-auth";

let ctx: SeedResult;
let otherCtx: SeedResult;
let customerId: string;
let customerEmail: string;
let token: string;

beforeAll(async () => {
  ctx = await seedOperator();
  otherCtx = await seedOperator();

  customerEmail = `push-${randomUUID().slice(0, 6)}@test.com`;
  const [customer] = await testDb
    .insert(customers)
    .values({ operatorId: ctx.operatorId, email: customerEmail })
    .returning({ id: customers.id });
  customerId = customer.id;

  token = signCustomerToken({
    customerId,
    operatorId: ctx.operatorId,
    email: customerEmail,
    name: null,
  });
});

afterAll(async () => {
  await cleanupOperator(ctx.operatorId);
  await cleanupOperator(otherCtx.operatorId);
});

function postReq(body: unknown, opts: { auth?: string; operatorIdHeader?: string } = {}) {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (opts.auth !== undefined) headers["authorization"] = opts.auth;
  else headers["authorization"] = `Bearer ${token}`;
  if (opts.operatorIdHeader) headers["x-operator-id"] = opts.operatorIdHeader;
  return new NextRequest("http://localhost/api/push/register", {
    method: "POST",
    body: JSON.stringify(body),
    headers,
  });
}

function deleteReq(expoToken: string | null, opts: { auth?: string } = {}) {
  const url = new URL("http://localhost/api/push/register");
  if (expoToken) url.searchParams.set("token", expoToken);
  const headers: Record<string, string> = {};
  headers["authorization"] = opts.auth !== undefined ? opts.auth : `Bearer ${token}`;
  return new NextRequest(url, { method: "DELETE", headers });
}

describe("POST /api/push/register", () => {
  it("returns 401 without a Bearer token", async () => {
    const { POST } = await import("@/app/api/push/register/route");
    const res = await POST(postReq({ expoToken: "ExponentPushToken[abc]" }, { auth: "" }));
    expect(res.status).toBe(401);
  });

  it("returns 401 when the token's operatorId does not match the x-operator-id header", async () => {
    const { POST } = await import("@/app/api/push/register/route");
    const res = await POST(
      postReq({ expoToken: "ExponentPushToken[abc]" }, { operatorIdHeader: otherCtx.operatorId }),
    );
    expect(res.status).toBe(401);
  });

  it("returns 400 for a missing or invalid expoToken", async () => {
    const { POST } = await import("@/app/api/push/register/route");
    const res1 = await POST(postReq({}));
    expect(res1.status).toBe(400);
    const res2 = await POST(postReq({ expoToken: "not-a-real-token" }));
    expect(res2.status).toBe(400);
  });

  it("returns 200 and inserts a push token scoped to the authenticated customer", async () => {
    const expoToken = `ExponentPushToken[${randomUUID().slice(0, 8)}]`;
    const { POST } = await import("@/app/api/push/register/route");
    const res = await POST(postReq({ expoToken, notifyReminders: false }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);

    const [row] = await testDb
      .select()
      .from(pushTokens)
      .where(and(eq(pushTokens.operatorId, ctx.operatorId), eq(pushTokens.expoToken, expoToken)));
    expect(row).toBeDefined();
    expect(row.customerId).toBe(customerId);
    expect(row.customerEmail).toBe(customerEmail);
    expect(row.notifyReminders).toBe(false);
    expect(row.notifyCancellations).toBe(true);
    expect(row.active).toBe(true);
  });

  it("upserts on conflict instead of creating a duplicate row", async () => {
    const expoToken = `ExponentPushToken[${randomUUID().slice(0, 8)}]`;
    const { POST } = await import("@/app/api/push/register/route");
    await POST(postReq({ expoToken, notifyReminders: true }));
    await POST(postReq({ expoToken, notifyReminders: false }));

    const rows = await testDb
      .select()
      .from(pushTokens)
      .where(and(eq(pushTokens.operatorId, ctx.operatorId), eq(pushTokens.expoToken, expoToken)));
    expect(rows).toHaveLength(1);
    expect(rows[0].notifyReminders).toBe(false);
  });
});

describe("DELETE /api/push/register", () => {
  it("returns 401 without a Bearer token", async () => {
    const { DELETE } = await import("@/app/api/push/register/route");
    const res = await DELETE(deleteReq("ExponentPushToken[x]", { auth: "" }));
    expect(res.status).toBe(401);
  });

  it("returns 400 when the token query param is missing", async () => {
    const { DELETE } = await import("@/app/api/push/register/route");
    const res = await DELETE(deleteReq(null));
    expect(res.status).toBe(400);
  });

  it("deactivates the matching row for this customer only", async () => {
    const expoToken = `ExponentPushToken[${randomUUID().slice(0, 8)}]`;
    const otherEmail = `push-other-${randomUUID().slice(0, 6)}@test.com`;
    await testDb.insert(pushTokens).values([
      { operatorId: ctx.operatorId, expoToken, customerId, customerEmail },
      { operatorId: ctx.operatorId, expoToken: `${expoToken}-other`, customerEmail: otherEmail },
    ]);

    const { DELETE } = await import("@/app/api/push/register/route");
    const res = await DELETE(deleteReq(expoToken));
    expect(res.status).toBe(200);

    const [mine] = await testDb
      .select({ active: pushTokens.active })
      .from(pushTokens)
      .where(and(eq(pushTokens.operatorId, ctx.operatorId), eq(pushTokens.expoToken, expoToken)));
    expect(mine.active).toBe(false);

    const [others] = await testDb
      .select({ active: pushTokens.active })
      .from(pushTokens)
      .where(and(eq(pushTokens.operatorId, ctx.operatorId), eq(pushTokens.expoToken, `${expoToken}-other`)));
    expect(others.active).toBe(true);
  });
});
