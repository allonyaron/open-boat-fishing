/**
 * Seed the openboatfishing.com demo operator (MV Open Boat).
 *
 * Idempotent — safe to re-run. Skips existing rows by unique constraint.
 *
 * Usage:
 *   DATABASE_URL=... \
 *   STRIPE_CONNECTED_ACCOUNT_ID=acct_test_... \
 *   DEMO_ADMIN_PASSWORD=... \
 *   tsx packages/db/src/seed-demo.ts
 *
 * DEMO_ADMIN_PASSWORD defaults to a random 24-char string that is printed once
 * on first run — save it. On re-runs the admin row is skipped (idempotent), so
 * the password is only printed once.
 */
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { eq } from "drizzle-orm";
import * as bcrypt from "bcryptjs";
import * as crypto from "node:crypto";
import * as schema from "./schema.js";
import { demoOperatorData, demoDomainData, demoFleetData } from "./seed-demo-data.js";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) throw new Error("DATABASE_URL is not set");

const STRIPE_CONNECTED_ACCOUNT_ID = process.env.STRIPE_CONNECTED_ACCOUNT_ID ?? null;
const DEMO_ADMIN_EMAIL = process.env.DEMO_ADMIN_EMAIL ?? "demo-admin@openboatfishing.com";
const DEMO_ADMIN_NAME = process.env.DEMO_ADMIN_NAME ?? "Demo Admin";
const DEMO_ADMIN_PASSWORD =
  process.env.DEMO_ADMIN_PASSWORD ?? crypto.randomBytes(18).toString("base64url");

const client = postgres(DATABASE_URL);
const db = drizzle(client, { schema });

const toCents = (dollars: number) => Math.round(dollars * 100);

async function seedDemo() {
  // ── Operator (upsert by slug) ─────────────────────────────────────────────
  const [existingOp] = await db
    .select()
    .from(schema.operators)
    .where(eq(schema.operators.slug, demoOperatorData.slug));

  const op =
    existingOp ??
    (
      await db
        .insert(schema.operators)
        .values({
          name: demoOperatorData.name,
          slug: demoOperatorData.slug,
          emailFrom: demoOperatorData.emailFrom,
          emailDomain: demoOperatorData.emailDomain,
          phone: demoOperatorData.phone,
          dockAddress: demoOperatorData.dockAddress,
          dockMapsUrl: demoOperatorData.dockMapsUrl,
          stripeAccountId: STRIPE_CONNECTED_ACCOUNT_ID,
          stripeOnboardingComplete: STRIPE_CONNECTED_ACCOUNT_ID !== null,
        })
        .returning()
    )[0];

  console.log(
    existingOp
      ? `↺ Operator exists: ${op.name} (${op.id})`
      : `✓ Operator created: ${op.name} (${op.id})`,
  );

  // ── Vessels + Products + Prices ───────────────────────────────────────────
  const existingVessels = await db
    .select()
    .from(schema.vessels)
    .where(eq(schema.vessels.operatorId, op.id));
  const existingVesselSlugs = new Set(existingVessels.map((v) => v.slug));

  for (const { products, ...vesselFields } of demoFleetData) {
    if (existingVesselSlugs.has(vesselFields.slug)) {
      console.log(`↺ Vessel exists: ${vesselFields.name}`);
      continue;
    }

    const [vessel] = await db
      .insert(schema.vessels)
      .values({ operatorId: op.id, ...vesselFields })
      .returning();

    for (const p of products) {
      const [product] = await db
        .insert(schema.products)
        .values({
          operatorId: op.id,
          vesselId: vessel.id,
          category: p.category,
          displayName: p.displayName,
          showRemaining: p.showRemaining,
        })
        .returning();

      const priceRows: {
        productId: string;
        ticketType: "adult" | "child" | "senior";
        priceCents: number;
      }[] = [];
      if (p.adult)
        priceRows.push({ productId: product.id, ticketType: "adult", priceCents: toCents(p.adult) });
      if (p.child)
        priceRows.push({ productId: product.id, ticketType: "child", priceCents: toCents(p.child) });

      if (priceRows.length > 0) {
        await db.insert(schema.productPrices).values(priceRows);
      }
    }

    console.log(`  ✓ ${vessel.name}: ${products.length} products`);
  }

  // ── Domains (skip existing by unique domain) ──────────────────────────────
  const existingDomains = await db.select().from(schema.domains);
  const existingDomainSet = new Set(existingDomains.map((d) => d.domain));
  const newDomains = demoDomainData.filter((d) => !existingDomainSet.has(d.domain));

  if (newDomains.length > 0) {
    await db.insert(schema.domains).values(newDomains.map((d) => ({ operatorId: op.id, ...d })));
    console.log(`  ✓ Domains: ${newDomains.map((d) => d.domain).join(", ")}`);
  } else {
    console.log(`↺ Domains already registered`);
  }

  // ── Admin staff ───────────────────────────────────────────────────────────
  const [existingAdmin] = await db
    .select({ id: schema.staff.id })
    .from(schema.staff)
    .where(eq(schema.staff.email, DEMO_ADMIN_EMAIL));

  if (existingAdmin) {
    console.log(`↺ Admin exists: ${DEMO_ADMIN_EMAIL} (password not re-printed)`);
  } else {
    const passwordHash = await bcrypt.hash(DEMO_ADMIN_PASSWORD, 12);
    await db.insert(schema.staff).values({
      operatorId: op.id,
      name: DEMO_ADMIN_NAME,
      email: DEMO_ADMIN_EMAIL,
      passwordHash,
      role: "admin",
      active: true,
    });
    console.log(`  ✓ Admin created: ${DEMO_ADMIN_EMAIL}`);
    console.log(``);
    console.log(`  ⚠  SAVE THIS PASSWORD — it will not be shown again:`);
    console.log(`     ${DEMO_ADMIN_PASSWORD}`);
    console.log(``);
    console.log(`  Login at: https://openboatfishing.com/admin/login`);
  }

  console.log(`\n✓ Demo seed complete`);
  await client.end();
}

seedDemo().catch((err) => {
  console.error(err);
  process.exit(1);
});
