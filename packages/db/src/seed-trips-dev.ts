import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "./schema.js";
import { eq, and } from "drizzle-orm";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) throw new Error("DATABASE_URL is not set");

const client = postgres(DATABASE_URL);
const db = drizzle(client, { schema });

// Jul–Sep 2026 dev season
const SEASON_START = "2026-07-01";
const SEASON_END = "2026-09-30";
const CAPACITY = 29;

// Days of week each vessel runs (0=Sun … 6=Sat)
const VESSEL_SCHEDULE: Record<
  string,
  { days: number[]; departureHourUtc: number; returnHourUtc: number }
> = {
  "blue-wave": { days: [2, 4, 6, 0], departureHourUtc: 11, returnHourUtc: 16 }, // 7AM–12PM ET
  "blue-wave-express": { days: [1, 3, 5, 6], departureHourUtc: 23, returnHourUtc: 4 }, // 7PM–12AM ET (next day)
  "harbor-princess": { days: [0, 6], departureHourUtc: 10, returnHourUtc: 18 }, // 6AM–2PM ET
  "harbor-star": { days: [0, 6], departureHourUtc: 12, returnHourUtc: 20 }, // 8AM–4PM ET
};

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
  const [op] = await db.select().from(schema.operators).limit(1);
  if (!op) throw new Error("No operator found — run `pnpm seed` first");

  const vessels = await db
    .select()
    .from(schema.vessels)
    .where(eq(schema.vessels.operatorId, op.id));

  if (vessels.length === 0) throw new Error("No vessels found — run `pnpm seed` first");

  // Check idempotency: skip if schedules already exist
  const existingSchedules = await db
    .select()
    .from(schema.schedules)
    .where(eq(schema.schedules.operatorId, op.id));

  if (existingSchedules.length > 0) {
    console.log(`✓ Already seeded — ${existingSchedules.length} schedule(s) exist. Skipping.`);
    await client.end();
    return;
  }

  let totalTrips = 0;

  for (const vessel of vessels) {
    const sched = VESSEL_SCHEDULE[vessel.slug];
    if (!sched) {
      console.log(`  ⚠ No schedule config for vessel slug "${vessel.slug}" — skipping`);
      continue;
    }

    // Pick first product for this vessel that has at least one price
    const products = await db
      .select()
      .from(schema.products)
      .where(and(eq(schema.products.vesselId, vessel.id), eq(schema.products.active, true)));

    const prices = await db
      .select()
      .from(schema.productPrices)
      .where(eq(schema.productPrices.active, true));

    const product = products.find(
      (p) => p.category !== "Fireworks" && prices.some((pr) => pr.productId === p.id),
    );
    if (!product) {
      console.log(`  ⚠ No priced product found for ${vessel.name} — skipping`);
      continue;
    }

    // Convert HH:MM:SS strings for schedule
    const depTime = `${String(sched.departureHourUtc).padStart(2, "0")}:00:00`;
    const retTime = `${String(sched.returnHourUtc).padStart(2, "0")}:00:00`;

    const dayNames = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;
    const daysOfWeek = sched.days.map((d) => dayNames[d]);

    const [schedule] = await db
      .insert(schema.schedules)
      .values({
        operatorId: op.id,
        productId: product.id,
        startDate: SEASON_START,
        endDate: SEASON_END,
        daysOfWeek,
        departureTime: depTime,
        returnTime: retTime,
        capacity: CAPACITY,
      })
      .returning();

    const dates = datesInRange(SEASON_START, SEASON_END, sched.days);

    const tripRows = dates.map((date) => {
      const depHour = sched.departureHourUtc;
      const retHour = sched.returnHourUtc;
      // Handle overnight trips (return hour < departure hour means next calendar day)
      const retDate =
        retHour < depHour
          ? new Date(new Date(`${date}T00:00:00Z`).getTime() + 86400000).toISOString().slice(0, 10)
          : date;

      return {
        operatorId: op.id,
        scheduleId: schedule.id,
        productId: product.id,
        vesselId: vessel.id,
        departureDate: date,
        startTime: new Date(`${date}T${depTime}Z`),
        endTime: new Date(`${retDate}T${retTime}Z`),
        capacity: CAPACITY,
        seatsRemaining: CAPACITY,
      };
    });

    await db.insert(schema.trips).values(tripRows);
    totalTrips += tripRows.length;
    console.log(
      `  ✓ ${vessel.name}: "${product.displayName}" — ${tripRows.length} trips (${dates[0]} → ${dates[dates.length - 1]})`,
    );
  }

  console.log(`\n✓ Trip seed complete — ${totalTrips} trips across ${vessels.length} vessels`);
  await client.end();
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
