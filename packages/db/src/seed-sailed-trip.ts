/**
 * Marks today's trip as sailed so the fishing report form is visible
 * in the admin UI. Safe to re-run — idempotent.
 *
 * Usage:
 *   cd packages/db && DATABASE_URL=... tsx src/seed-sailed-trip.ts
 */
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "./schema.js";
import { eq, and } from "drizzle-orm";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) throw new Error("DATABASE_URL is not set");

const client = postgres(DATABASE_URL);
const db = drizzle(client, { schema });

const today = new Date().toISOString().slice(0, 10);

async function run() {
  const [op] = await db.select().from(schema.operators).limit(1);
  if (!op) throw new Error("No operator");

  const [trip] = await db
    .select()
    .from(schema.trips)
    .where(and(eq(schema.trips.departureDate, today), eq(schema.trips.operatorId, op.id)))
    .limit(1);

  if (!trip) {
    console.error(`No trip found for ${today}. Run seed-test-trip.ts first.`);
    process.exit(1);
  }

  if (trip.status === "sailed") {
    console.log(`Trip ${trip.id} (${today}) is already sailed — nothing to do.`);
    await client.end();
    return;
  }

  await db
    .update(schema.trips)
    .set({ status: "sailed", sailedAt: new Date(), updatedAt: new Date() })
    .where(eq(schema.trips.id, trip.id));

  console.log(`✓ Marked trip ${trip.id} (${today}) as sailed`);
  await client.end();
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
