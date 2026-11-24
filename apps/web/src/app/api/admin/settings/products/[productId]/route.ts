import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/session";
import { recordChange } from "@/lib/audit";
import { products, productPrices } from "@openboat/db";
import { and, eq } from "drizzle-orm";

/** Prices as { adult: 4500, … }, for the audit log. */
function priceMap(rows: { ticketType: string; priceCents: number }[]): Record<string, number> {
  return Object.fromEntries(rows.map((r) => [r.ticketType, r.priceCents]).sort());
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: { productId: string } },
) {
  const auth = await requireAdmin(req);
  if (auth instanceof NextResponse) return auth;
  const { session, ctx } = auth;

  const { productId } = params;
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;

  const [product] = await db
    .select({ id: products.id })
    .from(products)
    .where(and(eq(products.id, productId), eq(products.operatorId, session.operatorId)));

  if (!product) return NextResponse.json({ error: "Product not found" }, { status: 404 });

  const allowed = ["category", "displayName", "description", "imageUrl", "whatToBring", "showRemaining", "active"] as const;
  const patch: Record<string, unknown> = { updatedAt: new Date() };
  for (const key of allowed) {
    if (key in body) patch[key] = body[key];
  }

  // The product and its prices change together, with who changed them.
  const priceInput = body.prices as Array<{ ticketType: string; priceCents: number }> | undefined;
  const { updated, prices } = await db.transaction(async (tx) => {
    const [before] = await tx
      .select()
      .from(products)
      .where(and(eq(products.id, productId), eq(products.operatorId, session.operatorId)))
      .for("update");
    const pricesBefore = await tx.select().from(productPrices).where(eq(productPrices.productId, productId));

    const [row] = await tx
      .update(products)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .set(patch as any)
      .where(and(eq(products.id, productId), eq(products.operatorId, session.operatorId)))
      .returning();

    // Upsert prices if provided
    if (Array.isArray(priceInput)) {
      const validTypes = ["adult", "child", "senior"] as const;
      for (const p of priceInput) {
        if (!validTypes.includes(p.ticketType as (typeof validTypes)[number])) continue;
        if (!Number.isInteger(p.priceCents) || p.priceCents < 0) continue;
        await tx
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

    const pricesAfter = await tx.select().from(productPrices).where(eq(productPrices.productId, productId));
    await recordChange(tx, ctx, {
      operatorId: session.operatorId,
      action: "product.update",
      targetTable: "products",
      targetId: productId,
      before: { ...before, prices: priceMap(pricesBefore) },
      set: { ...patch, prices: priceMap(pricesAfter) },
    });
    return { updated: row, prices: pricesAfter };
  });

  return NextResponse.json({ ...updated, prices });
}
