import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";
import { seedOperator, cleanupOperator, testDb } from "../db-helpers";
import type { SeedResult } from "../db-helpers";
import { products, productPrices } from "@openboat/db";
import { and, eq } from "drizzle-orm";

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

describe("GET /api/admin/settings/products", () => {
  it("returns 401 when not authenticated", async () => {
    vi.mocked(requireAdmin).mockResolvedValueOnce(unauthorized());
    const { GET } = await import("@/app/api/admin/settings/products/route");
    const res = await GET(getReq("/api/admin/settings/products"));
    expect(res.status).toBe(401);
  });

  it("returns 200 with the seeded product and its prices", async () => {
    const { GET } = await import("@/app/api/admin/settings/products/route");
    const res = await GET(getReq("/api/admin/settings/products"));
    expect(res.status).toBe(200);
    const body = await res.json();
    const found = body.find((p: { id: string }) => p.id === ctx.productId);
    expect(found).toBeDefined();
    expect(Array.isArray(found.prices)).toBe(true);
    expect(found.prices.length).toBeGreaterThan(0);
  });
});

describe("POST /api/admin/settings/products", () => {
  it("returns 401 when not authenticated", async () => {
    vi.mocked(requireAdmin).mockResolvedValueOnce(unauthorized());
    const { POST } = await import("@/app/api/admin/settings/products/route");
    const res = await POST(
      postReq("/api/admin/settings/products", { vesselId: ctx.vesselId, category: "fishing", displayName: "X" }),
    );
    expect(res.status).toBe(401);
  });

  it("returns 400 when vesselId is missing", async () => {
    const { POST } = await import("@/app/api/admin/settings/products/route");
    const res = await POST(postReq("/api/admin/settings/products", { category: "fishing", displayName: "X" }));
    expect(res.status).toBe(400);
  });

  it("returns 400 when displayName is missing", async () => {
    const { POST } = await import("@/app/api/admin/settings/products/route");
    const res = await POST(
      postReq("/api/admin/settings/products", { vesselId: ctx.vesselId, category: "fishing" }),
    );
    expect(res.status).toBe(400);
  });

  it("returns 404 when vesselId belongs to another operator", async () => {
    const { POST } = await import("@/app/api/admin/settings/products/route");
    const res = await POST(
      postReq("/api/admin/settings/products", {
        vesselId: otherCtx.vesselId,
        category: "fishing",
        displayName: "Hijack Product",
      }),
    );
    expect(res.status).toBe(404);
  });

  it("returns 201, creates the product, and filters invalid price rows", async () => {
    const { POST } = await import("@/app/api/admin/settings/products/route");
    const res = await POST(
      postReq("/api/admin/settings/products", {
        vesselId: ctx.vesselId,
        category: "fishing",
        displayName: "Sunset Cruise",
        whatToBring: ["sunscreen", "  ", "hat"],
        prices: [
          { ticketType: "adult", priceCents: 5000 },
          { ticketType: "child", priceCents: -100 }, // invalid: negative
          { ticketType: "bogus", priceCents: 5000 }, // invalid: bad ticketType
        ],
      }),
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.whatToBring).toEqual(["sunscreen", "hat"]);
    expect(body.prices).toHaveLength(1);
    expect(body.prices[0]).toMatchObject({ ticketType: "adult", priceCents: 5000 });

    const [row] = await testDb.select().from(products).where(eq(products.id, body.id));
    expect(row.operatorId).toBe(ctx.operatorId);
  });
});

describe("PATCH /api/admin/settings/products/[productId]", () => {
  it("returns 401 when not authenticated", async () => {
    vi.mocked(requireAdmin).mockResolvedValueOnce(unauthorized());
    const { PATCH } = await import("@/app/api/admin/settings/products/[productId]/route");
    const res = await PATCH(patchReq(`/api/admin/settings/products/${ctx.productId}`, { displayName: "X" }), {
      params: { productId: ctx.productId },
    });
    expect(res.status).toBe(401);
  });

  it("returns 404 for an unknown productId", async () => {
    const { PATCH } = await import("@/app/api/admin/settings/products/[productId]/route");
    const res = await PATCH(
      patchReq("/api/admin/settings/products/00000000-0000-0000-0000-000000000000", { displayName: "X" }),
      { params: { productId: "00000000-0000-0000-0000-000000000000" } },
    );
    expect(res.status).toBe(404);
  });

  it("returns 404 for a product belonging to another operator", async () => {
    const { PATCH } = await import("@/app/api/admin/settings/products/[productId]/route");
    const res = await PATCH(
      patchReq(`/api/admin/settings/products/${otherCtx.productId}`, { displayName: "Hijacked" }),
      { params: { productId: otherCtx.productId } },
    );
    expect(res.status).toBe(404);
  });

  it("returns 200, updates displayName, and upserts an existing ticketType price without duplicating the row", async () => {
    const { PATCH } = await import("@/app/api/admin/settings/products/[productId]/route");
    const res = await PATCH(
      patchReq(`/api/admin/settings/products/${ctx.productId}`, {
        displayName: "Renamed Trip",
        prices: [{ ticketType: "adult", priceCents: 12000 }],
      }),
      { params: { productId: ctx.productId } },
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.displayName).toBe("Renamed Trip");
    const adultPrice = body.prices.find((p: { ticketType: string }) => p.ticketType === "adult");
    expect(adultPrice.priceCents).toBe(12000);

    const rows = await testDb
      .select()
      .from(productPrices)
      .where(and(eq(productPrices.productId, ctx.productId), eq(productPrices.ticketType, "adult")));
    expect(rows).toHaveLength(1);
    expect(rows[0].priceCents).toBe(12000);
  });

  it("inserts a new ticketType price that did not previously exist", async () => {
    const { PATCH } = await import("@/app/api/admin/settings/products/[productId]/route");
    const res = await PATCH(
      patchReq(`/api/admin/settings/products/${ctx.productId}`, {
        prices: [{ ticketType: "senior", priceCents: 8000 }],
      }),
      { params: { productId: ctx.productId } },
    );
    expect(res.status).toBe(200);
    const rows = await testDb
      .select()
      .from(productPrices)
      .where(and(eq(productPrices.productId, ctx.productId), eq(productPrices.ticketType, "senior")));
    expect(rows).toHaveLength(1);
    expect(rows[0].priceCents).toBe(8000);
  });
});
