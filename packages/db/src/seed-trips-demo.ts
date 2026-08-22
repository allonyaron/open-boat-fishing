/**
 * Seed schedules + trips for the MV Open Boat demo operator through end-of-2035.
 *
 * Idempotent — per-vessel. A vessel that already has a schedule is skipped, so
 * re-running is safe. To extend into the future you can bump SEASON_END and
 * delete the existing schedule row (or add a new one via the admin wizard).
 *
 * Usage:
 *   DATABASE_URL=... tsx packages/db/src/seed-trips-demo.ts
 */
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { eq, and } from "drizzle-orm";
import * as schema from "./schema.js";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) throw new Error("DATABASE_URL is not set");

const OPERATOR_SLUG = "mv-open-boat";
const SEASON_END = "2035-12-31";

// Start from today (UTC calendar day) so past-dated trips aren't created.
const SEASON_START = new Date().toISOString().slice(0, 10);

const client = postgres(DATABASE_URL);
const db = drizzle(client, { schema });

// Schedule config per vessel slug. Hours in UTC — during EDT (UTC-4) most of
// the season, 11:00 UTC ≈ 7 AM ET. Close enough for a demo; real operators
// would set local times in the admin wizard.
const VESSEL_SCHEDULE: Record<
  string,
  {
    productDisplayName: string;
    days: number[]; // 0=Sun … 6=Sat
    departureHourUtc: number;
    returnHourUtc: number;
    label: string;
  }
> = {
  "open-boat-1": {
    productDisplayName: "Bay Fluke Half-Day",
    days: [1, 2, 3, 4, 5], // Mon–Fri
    departureHourUtc: 11, // 7 AM ET
    returnHourUtc: 16, // 12 PM ET
    label: "weekday mornings",
  },
  "open-boat-2": {
    productDisplayName: "Full-Day Blackfish",
    days: [0, 6], // Sat, Sun
    departureHourUtc: 10, // 6 AM ET
    returnHourUtc: 19, // 3 PM ET
    label: "weekends",
  },
  "open-boat-nightfall": {
    productDisplayName: "Night Bluefish",
    days: [5, 6], // Fri, Sat nights
    departureHourUtc: 23, // 7 PM ET
    returnHourUtc: 4, // 12 AM ET (next calendar day)
    label: "Fri/Sat nights",
  },
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
  const [op] = await db
    .select()
    .from(schema.operators)
    .where(eq(schema.operators.slug, OPERATOR_SLUG));

  if (!op) throw new Error(`Operator "${OPERATOR_SLUG}" not found — run seed-demo.ts first`);

  const vessels = await db
    .select()
    .from(schema.vessels)
    .where(eq(schema.vessels.operatorId, op.id));

  if (vessels.length === 0) throw new Error(`No vessels for ${op.name} — run seed-demo.ts first`);

  console.log(`Seeding trips ${SEASON_START} → ${SEASON_END} for ${op.name}`);

  let totalTrips = 0;

  for (const vessel of vessels) {
    const sched = VESSEL_SCHEDULE[vessel.slug];
    if (!sched) {
      console.log(`  ⚠ No schedule config for vessel slug "${vessel.slug}" — skipping`);
      continue;
    }

    // Idempotency: skip this vessel if it already has an active schedule.
    const existingSchedules = await db
      .select({ id: schema.schedules.id })
      .from(schema.schedules)
      .innerJoin(schema.products, eq(schema.products.id, schema.schedules.productId))
      .where(and(eq(schema.products.vesselId, vessel.id), eq(schema.schedules.active, true)));

    if (existingSchedules.length > 0) {
      console.log(`  ↺ ${vessel.name}: schedule already exists — skipping`);
      continue;
    }

    // Find the product with a matching displayName that has at least one price.
    const products = await db
      .select()
      .from(schema.products)
      .where(and(eq(schema.products.vesselId, vessel.id), eq(schema.products.active, true)));

    const product = products.find((p) => p.displayName === sched.productDisplayName);
    if (!product) {
      console.log(
        `  ⚠ ${vessel.name}: product "${sched.productDisplayName}" not found — skipping`,
      );
      continue;
    }

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
        capacity: vessel.capacity,
      })
      .returning();

    const dates = datesInRange(SEASON_START, SEASON_END, sched.days);

    const tripRows = dates.map((date) => {
      // Overnight trips (return hour < departure hour) end the next calendar day.
      const retDate =
        sched.returnHourUtc < sched.departureHourUtc
          ? new Date(new Date(`${date}T00:00:00Z`).getTime() + 86400000)
              .toISOString()
              .slice(0, 10)
          : date;

      return {
        operatorId: op.id,
        scheduleId: schedule.id,
        productId: product.id,
        vesselId: vessel.id,
        departureDate: date,
        startTime: new Date(`${date}T${depTime}Z`),
        endTime: new Date(`${retDate}T${retTime}Z`),
        capacity: vessel.capacity,
        seatsRemaining: vessel.capacity,
      };
    });

    // Chunk large insert to keep Postgres happy (single statement param limit).
    const CHUNK = 1000;
    for (let i = 0; i < tripRows.length; i += CHUNK) {
      await db.insert(schema.trips).values(tripRows.slice(i, i + CHUNK));
    }

    totalTrips += tripRows.length;
    console.log(
      `  ✓ ${vessel.name} (${sched.label}): "${product.displayName}" — ${tripRows.length} trips`,
    );
  }

  console.log(`\n✓ Trip seed complete — ${totalTrips} trips through ${SEASON_END}`);
  await client.end();
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
