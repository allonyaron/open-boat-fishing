import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";
import { seedOperator, cleanupOperator, testDb } from "../db-helpers";
import type { SeedResult } from "../db-helpers";
import { operators, domains, staff } from "@openboat/db";
import { eq } from "drizzle-orm";
import { randomUUID } from "crypto";

vi.mock("@/lib/platform-session", () => ({
  requirePlatform: vi.fn(),
}));

import { requirePlatform } from "@/lib/platform-session";

let ctx: SeedResult;
const createdOperatorIds: string[] = [];

beforeAll(async () => {
  ctx = await seedOperator();
});

afterAll(async () => {
  await cleanupOperator(ctx.operatorId);
  for (const id of createdOperatorIds) {
    await cleanupOperator(id);
  }
});

function unauthorized() {
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}

beforeEach(() => {
  vi.mocked(requirePlatform).mockResolvedValue({ session: { authenticated: true } } as any);
});

function getReq() {
  return new NextRequest("http://localhost/api/platform/operators");
}

function postReq(body: object) {
  return new NextRequest("http://localhost/api/platform/operators", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
}

describe("GET /api/platform/operators", () => {
  it("returns 401 when not authenticated", async () => {
    vi.mocked(requirePlatform).mockResolvedValueOnce(unauthorized());
    const { GET } = await import("@/app/api/platform/operators/route");
    const res = await GET(getReq());
    expect(res.status).toBe(401);
  });

  it("returns 200 with the seeded operator in the list", async () => {
    const { GET } = await import("@/app/api/platform/operators/route");
    const res = await GET(getReq());
    expect(res.status).toBe(200);
    const body = await res.json();
    const found = body.find((o: { id: string }) => o.id === ctx.operatorId);
    expect(found).toBeDefined();
    expect(found.slug).toBeDefined();
  });
});

describe("POST /api/platform/operators", () => {
  const validBody = () => ({
    name: `New Fishing Co ${randomUUID().slice(0, 8)}`,
    domain: `newop-${randomUUID().slice(0, 8)}.example.com`,
    emailFrom: "office@example.com",
    emailDomain: "example.com",
    adminName: "Op Admin",
    adminEmail: `admin-${randomUUID().slice(0, 8)}@example.com`,
  });

  it("returns 401 when not authenticated", async () => {
    vi.mocked(requirePlatform).mockResolvedValueOnce(unauthorized());
    const { POST } = await import("@/app/api/platform/operators/route");
    const res = await POST(postReq(validBody()));
    expect(res.status).toBe(401);
  });

  it("returns 400 for an invalid domain format", async () => {
    const { POST } = await import("@/app/api/platform/operators/route");
    const res = await POST(postReq({ ...validBody(), domain: "not a domain!" }));
    expect(res.status).toBe(400);
  });

  it("returns 400 for an invalid admin email", async () => {
    const { POST } = await import("@/app/api/platform/operators/route");
    const res = await POST(postReq({ ...validBody(), adminEmail: "not-an-email" }));
    expect(res.status).toBe(400);
  });

  it("returns 400 when required fields are missing", async () => {
    const { POST } = await import("@/app/api/platform/operators/route");
    const res = await POST(postReq({ name: "X" }));
    expect(res.status).toBe(400);
  });

  it("returns 409 when the domain is already registered", async () => {
    const body = validBody();
    const { POST } = await import("@/app/api/platform/operators/route");
    const first = await POST(postReq(body));
    expect(first.status).toBe(200);
    const firstBody = await first.json();
    createdOperatorIds.push(firstBody.operatorId);

    const dup = await POST(postReq({ ...validBody(), domain: body.domain }));
    expect(dup.status).toBe(409);
  });

  it("returns 200 and creates the operator, domain, and admin staff account", async () => {
    const body = validBody();
    const { POST } = await import("@/app/api/platform/operators/route");
    const res = await POST(postReq(body));
    expect(res.status).toBe(200);
    const respBody = await res.json();
    createdOperatorIds.push(respBody.operatorId);

    expect(respBody.domain).toBe(body.domain);
    expect(respBody.adminEmail).toBe(body.adminEmail.toLowerCase());
    expect(respBody.tempPassword).toHaveLength(16);
    expect(respBody.loginUrl).toBe(`https://${body.domain}/admin`);

    const [op] = await testDb.select().from(operators).where(eq(operators.id, respBody.operatorId));
    expect(op.name).toBe(body.name);

    const [domain] = await testDb.select().from(domains).where(eq(domains.operatorId, respBody.operatorId));
    expect(domain.domain).toBe(body.domain);
    expect(domain.primary).toBe(true);

    const [admin] = await testDb.select().from(staff).where(eq(staff.operatorId, respBody.operatorId));
    expect(admin.email).toBe(body.adminEmail.toLowerCase());
    expect(admin.role).toBe("admin");
    expect(admin.passwordHash).not.toBe(respBody.tempPassword);
  });
});
