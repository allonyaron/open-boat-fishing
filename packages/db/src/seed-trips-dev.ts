import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "./schema.js";
import { eq } from "drizzle-orm";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) throw new Error("DATABASE_URL is not set");

const client = postgres(DATABASE_URL);
const db = drizzle(client, { schema });

const OPERATOR_ID = "bd6fa742-6657-4cdd-a12c-0980d4f67b1b";
const PRODUCT_ID  = "7c362520-b87f-43e3-90c1-aa0ec0a4cccc";

function datesInRange(start: string, end: string, days: number[]): string[] {
  const dates: string[] = [];
  const cur = new Date(start + "T12:00:00Z");
  const endDate = new Date(end + "T12:00:00Z");
  while (cur <= endDate) {
    if (days.includes(cur.getUTCDay())) {
      dates.push(cur.toISOString().slice(0, 10));
    }
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return dates;
}

async function run() {
  const [product] = await db
    .select()
    .from(schema.products)
    .where(eq(schema.products.id, PRODUCT_ID));

  if (!product) throw new Error("Product not found");

  // Insert schedule
  const [schedule] = await db
    .insert(schema.schedules)
    .values({
      operatorId:    OPERATOR_ID,
      productId:     PRODUCT_ID,
      startDate:     "2026-07-01",
      endDate:       "2026-09-30",
      daysOfWeek:    ["tue", "thu", "sat", "sun"],
      departureTime: "07:01:00",
      returnTime:    "12:00:00",
      capacity:      29,
    })
    .returning();

  console.log(`✓ Schedule created: ${schedule.id}`);

  // Materialize trips — Tue=2, Thu=4, Sat=6, Sun=0
  const dates = datesInRange("2026-07-01", "2026-09-30", [0, 2, 4, 6]);

  const tripRows = dates.map((date) => ({
    operatorId:    OPERATOR_ID,
    scheduleId:    schedule.id,
    productId:     PRODUCT_ID,
    vesselId:      product.vesselId,
    departureDate: date,
    startTime:     new Date(`${date}T11:01:00Z`),  // 7:01 AM ET = 11:01 UTC
    endTime:       new Date(`${date}T16:00:00Z`),  // 12:00 PM ET = 16:00 UTC
    capacity:      29,
    seatsRemaining: 29,
  }));

  await db.insert(schema.trips).values(tripRows);
  console.log(`✓ ${tripRows.length} trips materialized (Jul–Sep 2026)`);
  console.log(`  First: ${tripRows[0].departureDate} → Last: ${tripRows[tripRows.length - 1].departureDate}`);

  await client.end();
}

run().catch((err) => { console.error(err); process.exit(1); });
