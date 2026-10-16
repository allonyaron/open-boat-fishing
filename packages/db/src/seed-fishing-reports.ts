/**
 * Seed fishing reports for one operator's recent past trips.
 *
 * Writes one report per past, non-cancelled trip in the window, skipping ~15%
 * of trips (blown out, or the captain never posted). Content comes from the
 * phrase pools in seed-fishing-reports-data.ts and is deterministic per trip
 * id, so re-runs produce the same text.
 *
 * Idempotent: trips that already have a report are left alone (unique trip_id).
 * Trip status is not touched — reports show regardless of status, and flipping
 * a trip to `sailed` means fees earned.
 *
 * Usage:
 *   DATABASE_URL=... tsx packages/db/src/seed-fishing-reports.ts <operator-slug> [--days=30] [--dry-run]
 *
 * Operator slug is required: `captree` for local dev, `mv-open-boat` for
 * openboatfishing.com. Run with --dry-run first against any shared database.
 */
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { and, eq, gte, inArray, lt, ne } from "drizzle-orm";
import * as schema from "./schema.js";
import {
  type Rng,
  type SpeciesProfile,
  SPECIES,
  SPECIES_RULES,
  NON_FISHING,
  FALLBACK_SPECIES,
  CAPTAINS,
  MATES,
  POOL_WINNERS,
  OPENERS,
  NIGHT_OPENERS,
  SLOW_OPENERS,
  CREW_LINES,
  POOL_LINES,
  CLOSERS,
  pick,
  between,
} from "./seed-fishing-reports-data.js";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) throw new Error("DATABASE_URL is not set");

const args = process.argv.slice(2);
const slug = args.find((a) => !a.startsWith("--"));
const dryRun = args.includes("--dry-run");
const days = Number(args.find((a) => a.startsWith("--days="))?.split("=")[1] ?? 30);
if (!slug) {
  console.error("Usage: tsx seed-fishing-reports.ts <operator-slug> [--days=30] [--dry-run]");
  process.exit(1);
}
if (!Number.isInteger(days) || days < 1) throw new Error(`--days must be a positive integer`);

const SKIP_RATE = 0.15;
const SLOW_DAY_RATE = 0.15;

const client = postgres(DATABASE_URL);
const db = drizzle(client, { schema });

// mulberry32, seeded from the trip id so each trip's report is stable.
function rngFor(seed: string): Rng {
  let a = 0;
  for (let i = 0; i < seed.length; i++) a = (Math.imul(31, a) + seed.charCodeAt(i)) | 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function speciesFor(productName: string, category: string): SpeciesProfile[] {
  const text = `${productName} ${category}`.toLowerCase();
  const keys = SPECIES_RULES.filter(([re]) => re.test(text)).map(([, k]) => k);
  return [...new Set(keys.length > 0 ? keys : FALLBACK_SPECIES)].slice(0, 3).map((k) => SPECIES[k]);
}

const fill = (template: string, vars: Record<string, string | number>) =>
  template.replace(/\{(\w+)\}/g, (_, k) => String(vars[k] ?? `{${k}}`));

function buildReport(tripId: string, productName: string, category: string, startTime: Date) {
  const rng = rngFor(tripId);
  if (rng() < SKIP_RATE) return null;

  const slow = rng() < SLOW_DAY_RATE;
  // Night trips depart 4 PM ET or later — 20:00 UTC is close enough for copy.
  const night = startTime.getUTCHours() >= 20 || startTime.getUTCHours() < 4;
  const scale = slow ? 0.35 : 1;

  const species = speciesFor(productName, category);
  if (rng() < 0.3) species.push(SPECIES.seaRobin);

  const fishCounts = species.map((s) => ({
    species: s.species,
    count: Math.max(1, Math.round(between(rng, s.count[0], s.count[1]) * scale)),
  }));

  const captain = pick(rng, CAPTAINS);
  const mate = pick(rng, MATES);
  const opener = pick(rng, slow ? SLOW_OPENERS : night ? NIGHT_OPENERS : OPENERS);
  const speciesLines = species.map((s, i) =>
    fill(pick(rng, s.lines), { n: fishCounts[i].count, big: s.bigOne }),
  );
  const crewLine = fill(pick(rng, CREW_LINES), { captain, mate });

  const poolFish = species.find((s) => s.poolLbs);
  const poolLine = poolFish?.poolLbs
    ? fill(pick(rng, POOL_LINES), {
        winner: pick(rng, POOL_WINNERS),
        lbs: (poolFish.poolLbs[0] + rng() * (poolFish.poolLbs[1] - poolFish.poolLbs[0]))
          .toFixed(1)
          .replace(/\.0$/, ""),
        species: poolFish.species.toLowerCase(),
        big: poolFish.bigOne,
      })
    : null;

  const catchSummary = [opener, ...speciesLines, crewLine, poolLine, pick(rng, CLOSERS)]
    .filter(Boolean)
    .join(" ");

  return { catchSummary, fishCounts, postedAfterMin: between(rng, 25, 140) };
}

async function run() {
  const host = new URL(DATABASE_URL!).host;
  console.log(`Database: ${host}`);
  console.log(`Operator: ${slug}   Window: last ${days} days${dryRun ? "   (DRY RUN)" : ""}`);

  const [op] = await db.select().from(schema.operators).where(eq(schema.operators.slug, slug!));
  if (!op) throw new Error(`Operator "${slug}" not found`);

  const now = new Date();
  const since = new Date(now.getTime() - days * 86_400_000).toISOString().slice(0, 10);

  const pastTrips = await db
    .select({
      id: schema.trips.id,
      vesselId: schema.trips.vesselId,
      departureDate: schema.trips.departureDate,
      startTime: schema.trips.startTime,
      endTime: schema.trips.endTime,
      productName: schema.products.displayName,
      category: schema.products.category,
    })
    .from(schema.trips)
    .innerJoin(schema.products, eq(schema.products.id, schema.trips.productId))
    .where(
      and(
        eq(schema.trips.operatorId, op.id),
        ne(schema.trips.status, "cancelled"),
        gte(schema.trips.departureDate, since),
        lt(schema.trips.endTime, now),
      ),
    );

  const existing =
    pastTrips.length === 0
      ? []
      : await db
          .select({ tripId: schema.fishingReports.tripId })
          .from(schema.fishingReports)
          .where(
            and(
              eq(schema.fishingReports.operatorId, op.id),
              inArray(
                schema.fishingReports.tripId,
                pastTrips.map((t) => t.id),
              ),
            ),
          );
  const reported = new Set(existing.map((r) => r.tripId));

  // Reports come from the captain's account when there is one.
  const crew = await db
    .select({ id: schema.staff.id, role: schema.staff.role })
    .from(schema.staff)
    .where(and(eq(schema.staff.operatorId, op.id), eq(schema.staff.active, true)));
  const staffId = (crew.find((s) => s.role === "mate") ?? crew[0])?.id ?? null;

  const rows = pastTrips
    .filter((t) => !reported.has(t.id) && !NON_FISHING.test(`${t.productName} ${t.category}`))
    .map((t) => {
      const report = buildReport(t.id, t.productName, t.category, t.startTime);
      if (!report) return null;
      const postedAt = new Date(t.endTime.getTime() + report.postedAfterMin * 60_000);
      return {
        operatorId: op.id,
        tripId: t.id,
        vesselId: t.vesselId,
        staffId,
        catchSummary: report.catchSummary,
        fishCounts: report.fishCounts,
        createdAt: postedAt,
        updatedAt: postedAt,
      };
    })
    .filter((r) => r !== null);

  console.log(
    `Past trips in window: ${pastTrips.length}   Already reported: ${reported.size}   To insert: ${rows.length}`,
  );

  if (rows.length > 0) {
    const sample = rows[rows.length - 1];
    console.log(`\nSample:\n  ${sample.catchSummary}\n  ${JSON.stringify(sample.fishCounts)}\n`);
  }

  if (dryRun || rows.length === 0) {
    console.log(dryRun ? "Dry run — nothing written." : "Nothing to insert.");
    await client.end();
    return;
  }

  const inserted = await db
    .insert(schema.fishingReports)
    .values(rows)
    .onConflictDoNothing({ target: schema.fishingReports.tripId })
    .returning({ id: schema.fishingReports.id });

  console.log(`✓ Inserted ${inserted.length} fishing reports for ${op.name}`);
  await client.end();
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
