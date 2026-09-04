import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/session";
import { products, productPrices, vessels } from "@openboat/db";
import { and, eq, inArray } from "drizzle-orm";

export async function GET(req: NextRequest) {
  const auth = await requireAdmin(req);
  if (auth instanceof NextResponse) return auth;
  const { session } = auth;

  const rows = await db
    .select({
      id: products.id,
      vesselId: products.vesselId,
      category: products.category,
      displayName: products.displayName,
      description: products.description,
      imageUrl: products.imageUrl,
      whatToBring: products.whatToBring,
      showRemaining: products.showRemaining,
      active: products.active,
      createdAt: products.createdAt,
      vessel: { id: vessels.id, name: vessels.name, color: vessels.color },
    })
    .from(products)
    .innerJoin(vessels, eq(products.vesselId, vessels.id))
    .where(eq(products.operatorId, session.operatorId))
    .orderBy(vessels.name, products.category);

  const productIds = rows.map((r) => r.id);
  const prices = productIds.length > 0
    ? await db.select().from(productPrices).where(inArray(productPrices.productId, productIds))
    : [];

  const priceMap = new Map<string, typeof prices>();
  for (const p of prices) {
    if (!priceMap.has(p.productId)) priceMap.set(p.productId, []);
    priceMap.get(p.productId)!.push(p);
  }

  return NextResponse.json(rows.map((r) => ({ ...r, prices: priceMap.get(r.id) ?? [] })));
}

export async function POST(req: NextRequest) {
  const auth = await requireAdmin(req);
  if (auth instanceof NextResponse) return auth;
  const { session } = auth;

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;

  const vesselId = String(body.vesselId ?? "").trim();
  const category = String(body.category ?? "").trim();
  const displayName = String(body.displayName ?? "").trim();

  if (!vesselId) return NextResponse.json({ error: "vesselId is required" }, { status: 400 });
  if (!category) return NextResponse.json({ error: "category is required" }, { status: 400 });
  if (!displayName) return NextResponse.json({ error: "displayName is required" }, { status: 400 });

  // Ensure vessel belongs to this operator
  const [vessel] = await db
    .select({ id: vessels.id })
    .from(vessels)
    .where(and(eq(vessels.id, vesselId), eq(vessels.operatorId, session.operatorId)));

  if (!vessel) return NextResponse.json({ error: "Vessel not found" }, { status: 404 });

  const rawWhatToBring = body.whatToBring;
  const whatToBring = Array.isArray(rawWhatToBring)
    ? (rawWhatToBring as string[]).map((s) => String(s).trim()).filter(Boolean)
    : [];

  const [product] = await db
    .insert(products)
    .values({
      operatorId: session.operatorId,
      vesselId,
      category,
      displayName,
      description: body.description ? String(body.description) : null,
      whatToBring,
      showRemaining: Boolean(body.showRemaining),
    })
    .returning();

  // Insert prices if provided
  const priceInput = body.prices as Array<{ ticketType: string; priceCents: number }> | undefined;
  if (Array.isArray(priceInput) && priceInput.length > 0) {
    const validTypes = ["adult", "child", "senior"] as const;
    const rows = priceInput
      .filter((p) => validTypes.includes(p.ticketType as (typeof validTypes)[number]) && Number.isInteger(p.priceCents) && p.priceCents >= 0)
      .map((p) => ({
        productId: product.id,
        ticketType: p.ticketType as (typeof validTypes)[number],
        priceCents: p.priceCents,
      }));
    if (rows.length > 0) await db.insert(productPrices).values(rows);
  }

  const insertedPrices = await db
    .select()
    .from(productPrices)
    .where(eq(productPrices.productId, product.id));

  return NextResponse.json({ ...product, prices: insertedPrices }, { status: 201 });
}
