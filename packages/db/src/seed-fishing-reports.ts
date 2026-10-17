/**
 * Seed fishing reports for one operator's recent past trips.
 *
 * Writes one report per past, non-cancelled trip in the window, skipping ~15%
 * of trips (blown out, or the captain never posted). Content comes from the
 * species profiles and phrase pools in seed-fishing-reports-data.ts and is
 * deterministic per trip id, so re-runs produce the same text.
 *
 * Voices: `logbook` (default) is the terse party-boat daily log — "Today's
 * 7:01AM trip caught 462 Fluke; keeping 54 to 7.4LBS, 33 Sea Bass and 1 Cape
 * Shark." `hype` is all-caps marketing copy with crew shoutouts and pools.
 *
 * Idempotent: trips that already have a report are left alone (unique trip_id).
 * Trip status is not touched — reports show regardless of status, and flipping
 * a trip to `sailed` means fees earned.
 *
 * Usage:
 *   DATABASE_URL=... tsx packages/db/src/seed-fishing-reports.ts <operator-slug> \
 *     [--days=30] [--voice=logbook|hype] [--dry-run]
 *
 * Operator slug is required: `captree` for local dev, `mv-open-boat` for
 * openboatfishing.com. Run with --dry-run first against any shared database.
 */
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { and, eq, gte, inArray, lt, ne } from "drizzle-orm";
import * as schema from "./schema.js";
import {
  type FishName,
  type Rng,
  type SpeciesProfile,
  SPECIES,
  SPECIES_RULES,
  NON_FISHING,
  FALLBACK_SPECIES,
  ODDBALLS,
  ODDBALL_RATE,
  FREE_FOR_LIFE_RATE,
  FREE_FOR_LIFE_LEADERS,
  SKUNK_RATE,
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

const USAGE =
  "Usage: tsx seed-fishing-reports.ts <operator-slug> [--days=30] [--voice=logbook|hype] [--dry-run]";
const args = process.argv.slice(2);
const flag = (name: string) => args.find((a) => a.startsWith(`--${name}=`))?.split("=")[1];
const slug = args.find((a) => !a.startsWith("--"));
const dryRun = args.includes("--dry-run");
const days = Number(flag("days") ?? 30);
const voice = flag("voice") ?? "logbook";
if (!slug) {
  console.error(USAGE);
  process.exit(1);
}
if (!Number.isInteger(days) || days < 1) throw new Error(`--days must be a positive integer`);
if (voice !== "logbook" && voice !== "hype") throw new Error(`--voice must be logbook or hype`);

const SKIP_RATE = 0.15;
const SLOW_DAY_RATE = 0.15;
const TZ = "America/New_York";

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

const lbs = (rng: Rng, [min, max]: [number, number]) =>
  (min + rng() * (max - min)).toFixed(rng() < 0.5 ? 1 : 2).replace(/\.?0+$/, "");

const label = (name: FishName, count: number) => (count === 1 ? name.one : name.many);

function shuffle<T>(rng: Rng, items: T[]): T[] {
  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [items[i], items[j]] = [items[j], items[i]];
  }
  return items;
}

/** "7:01AM", "6PM" — the departure time as the log writes it, in Eastern. */
function departureLabel(startTime: Date) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: TZ,
    hour: "numeric",
    minute: "2-digit",
    hourCycle: "h12",
  }).formatToParts(startTime);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  const hour24 = Number(
    new Intl.DateTimeFormat("en-US", { timeZone: TZ, hour: "numeric", hourCycle: "h23" }).format(startTime),
  );
  const minute = get("minute");
  return {
    time: `${get("hour")}${minute === "00" ? "" : `:${minute}`}${get("dayPeriod").toUpperCase()}`,
    night: hour24 >= 17 || hour24 < 4,
  };
}

interface Line {
  name: FishName;
  count: number;
  profile?: SpeciesProfile;
}

/** What came over the rail: target species first, then bycatch in no order. */
function buildCatch(rng: Rng, targets: SpeciesProfile[], scale: number): Line[] {
  const [primary, ...others] = targets;
  const count = (range: [number, number], factor = 1) =>
    Math.max(1, Math.round(between(rng, range[0], range[1]) * scale * factor));

  const lines: Line[] = [{ name: primary.name, count: count(primary.caught), profile: primary }];
  for (const t of others) lines.push({ name: t.name, count: count(t.caught, 0.5), profile: t });

  const rest: Line[] = [];
  for (const [name, min, max, chance] of primary.bycatch) {
    if (lines.some((l) => l.name === name) || rng() >= chance) continue;
    rest.push({ name, count: count([min, max]) });
  }
  if (rng() < ODDBALL_RATE) rest.push({ name: pick(rng, ODDBALLS), count: 1 });
  return [...lines, ...shuffle(rng, rest)];
}

const fmt = (n: number) => n.toLocaleString("en-US");

function logbookItem(rng: Rng, l: Line) {
  const base = `${fmt(l.count)} ${label(l.name, l.count)}`;
  const p = l.profile;
  if (!p) return base;
  if (p.fullLimitAt && l.count >= p.fullLimitAt) {
    return rng() < 0.5 ? `${base}; Keeping a Full Boat Limit` : `${base} keeping a Full Boat Limit`;
  }
  const to = p.maxLbs && rng() < 0.45 ? ` to ${lbs(rng, p.maxLbs)}LBS` : "";
  if (p.keepRate && l.count >= 20 && rng() < 0.6) {
    const kept = Math.max(1, Math.round(l.count * (p.keepRate[0] + rng() * (p.keepRate[1] - p.keepRate[0]))));
    return `${base}${rng() < 0.5 ? ";" : ""} keeping ${kept}${to}`;
  }
  return `${base}${to}`;
}

function listJoin(rng: Rng, items: string[]) {
  if (items.length <= 1) return items.join("");
  const oxford = items.length > 2 && rng() < 0.5 ? "," : "";
  return `${items.slice(0, -1).join(", ")}${oxford} and ${items[items.length - 1]}`;
}

function logbookSummary(rng: Rng, lines: Line[], time: string, night: boolean) {
  const when = `${night ? "Tonight's" : "Today's"} ${time} trip`;
  if (lines.length === 0) return `${when} caught nothing.`;
  let text = `${when} caught ${listJoin(rng, lines.map((l) => logbookItem(rng, l)))}.`;
  if (lines[0].profile === SPECIES.fluke && rng() < FREE_FOR_LIFE_RATE) {
    const leader = pick(rng, FREE_FOR_LIFE_LEADERS);
    text += rng() < 0.5 ? ` NEW FREE FOR LIFE LEADER ${leader.toUpperCase()}.` : ` New Free For Life leader ${leader}.`;
  }
  return text;
}

function hypeSummary(rng: Rng, lines: Line[], targets: SpeciesProfile[], slow: boolean, night: boolean) {
  const opener = pick(rng, slow ? SLOW_OPENERS : night ? NIGHT_OPENERS : OPENERS);
  const speciesLines = targets.map((t) =>
    fill(pick(rng, t.lines), { n: fmt(lines.find((l) => l.profile === t)!.count), big: t.bigOne }),
  );
  const crewLine = fill(pick(rng, CREW_LINES), { captain: pick(rng, CAPTAINS), mate: pick(rng, MATES) });
  const poolFish = targets.find((t) => t.maxLbs);
  const poolLine = poolFish?.maxLbs
    ? fill(pick(rng, POOL_LINES), {
        winner: pick(rng, POOL_WINNERS),
        lbs: lbs(rng, poolFish.maxLbs),
        species: poolFish.name.one.toLowerCase(),
        big: poolFish.bigOne,
      })
    : null;
  return [opener, ...speciesLines, crewLine, poolLine, pick(rng, CLOSERS)].filter(Boolean).join(" ");
}

function buildReport(tripId: string, productName: string, category: string, startTime: Date) {
  const rng = rngFor(tripId);
  if (rng() < SKIP_RATE) return null;

  const slow = rng() < SLOW_DAY_RATE;
  const { time, night } = departureLabel(startTime);
  const targets = speciesFor(productName, category);
  // Hype copy never admits to a skunk.
  const skunk = voice === "logbook" && night && rng() < SKUNK_RATE;
  const lines = skunk ? [] : buildCatch(rng, targets, slow ? 0.35 : 1);

  const catchSummary =
    voice === "logbook"
      ? logbookSummary(rng, lines, time, night)
      : hypeSummary(rng, lines, targets, slow, night);
  const fishCounts = lines.map((l) => ({ species: label(l.name, l.count), count: l.count }));

  return { catchSummary, fishCounts, postedAfterMin: between(rng, 25, 140) };
}

async function run() {
  const host = new URL(DATABASE_URL!).host;
  console.log(`Database: ${host}`);
  console.log(`Operator: ${slug}   Window: last ${days} days   Voice: ${voice}${dryRun ? "   (DRY RUN)" : ""}`);

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
    console.log(`\nSamples:`);
    const step = Math.max(1, Math.floor(rows.length / 6));
    for (const r of rows.filter((_, i) => i % step === 0).slice(0, 6)) console.log(`  ${r.catchSummary}`);
    console.log();
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
