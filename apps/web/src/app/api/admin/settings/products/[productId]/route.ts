import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/session";
import { products, productPrices } from "@openboat/db";
import { and, eq } from "drizzle-orm";

export async function PATCH(
  req: NextRequest,
  { params }: { params: { productId: string } },
) {
  const auth = await requireAdmin(req);
  if (auth instanceof NextResponse) return auth;
  const { session } = auth;

  const { productId } = params;
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;

  const [product] = await db
    .select({ id: products.id })
    .from(products)
    .where(and(eq(products.id, productId), eq(products.operatorId, session.operatorId)));

  if (!product) return NextResponse.json({ error: "Product not found" }, { status: 404 });

  const allowed = ["category", "displayName", "description", "imageUrl", "showRemaining", "active"] as const;
  const patch: Record<string, unknown> = { updatedAt: new Date() };
  for (const key of allowed) {
    if (key in body) patch[key] = body[key];
  }

  const [updated] = await db
    .update(products)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .set(patch as any)
    .where(eq(products.id, productId))
    .returning();

  // Upsert prices if provided
  const priceInput = body.prices as Array<{ ticketType: string; priceCents: number }> | undefined;
  if (Array.isArray(priceInput)) {
    const validTypes = ["adult", "child", "senior"] as const;
    for (const p of priceInput) {
      if (!validTypes.includes(p.ticketType as (typeof validTypes)[number])) continue;
      if (!Number.isInteger(p.priceCents) || p.priceCents < 0) continue;
      await db
        .insert(productPrices)
        .values({
          productId,
          ticketType: p.ticketType as (typeof validTypes)[number],
          priceCents: p.priceCents,
        })
        .onConflictDoUpdate({
          target: [productPrices.productId, productPrices.ticketType],
          set: { priceCents: p.priceCents },
        });
    }
  }

  const prices = await db
    .select()
    .from(productPrices)
    .where(eq(productPrices.productId, productId));

  return NextResponse.json({ ...updated, prices });
}
