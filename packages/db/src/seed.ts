import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "./schema.js";
import { operatorData, domainData, fleetData } from "./seed-data.js";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) throw new Error("DATABASE_URL is not set");

const client = postgres(DATABASE_URL);
const db = drizzle(client, { schema });

const toCents = (dollars: number) => Math.round(dollars * 100);

async function seed() {
  const [existing] = await db.select().from(schema.operators).limit(1);
  if (existing) {
    console.log("✓ Already seeded — database has an operator row. Skipping.");
    await client.end();
    return;
  }

  console.log(`Seeding ${operatorData.name}...`);

  // ── Operator ──────────────────────────────────────────────────────────────
  const [op] = await db.insert(schema.operators).values(operatorData).returning();
  console.log(`  ✓ Operator: ${op.name} (${op.id})`);

  // ── Vessels + Products + Prices ───────────────────────────────────────────
  let productCount = 0;
  let priceCount = 0;
  let noPriceCount = 0;

  for (const { products, ...vesselFields } of fleetData) {
    const [vessel] = await db.insert(schema.vessels).values({
      operatorId: op.id,
      ...vesselFields,
    }).returning();

    for (const p of products) {
      const [product] = await db.insert(schema.products).values({
        operatorId:    op.id,
        vesselId:      vessel.id,
        category:      p.category,
        displayName:   p.displayName,
        showRemaining: p.showRemaining,
      }).returning();

      productCount++;

      const prices: { productId: string; ticketType: "adult" | "child" | "senior"; priceCents: number }[] = [];
      if (p.adult) prices.push({ productId: product.id, ticketType: "adult", priceCents: toCents(p.adult) });
      if (p.child) prices.push({ productId: product.id, ticketType: "child", priceCents: toCents(p.child) });

      if (prices.length > 0) {
        await db.insert(schema.productPrices).values(prices);
        priceCount += prices.length;
      } else {
        noPriceCount++;
      }
    }

    console.log(`  ✓ ${vessel.name}: ${products.length} products`);
  }

  // ── Domains ───────────────────────────────────────────────────────────────
  await db.insert(schema.domains).values(
    domainData.map((d) => ({ operatorId: op.id, ...d }))
  );
  console.log(`  ✓ Domains: ${domainData.map((d) => d.domain).join(", ")}`);

  console.log(`\n✓ Seed complete`);
  console.log(`  ${productCount} products, ${priceCount} price rows`);
  if (noPriceCount > 0) {
    console.log(`  ${noPriceCount} products have no prices yet — set via admin dashboard`);
  }

  await client.end();
}

seed().catch((err) => {
  console.error(err);
  process.exit(1);
});
