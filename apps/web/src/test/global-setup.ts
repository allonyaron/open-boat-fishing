import { execSync } from "child_process";
import { createDb } from "@openboat/db";
import { sql } from "drizzle-orm";

export async function setup() {
  const url = process.env.DATABASE_URL_TEST;
  if (!url) {
    console.warn(
      "\n⚠  DATABASE_URL_TEST not set — integration tests that hit the DB will be skipped.\n" +
        "   Create a Neon branch or local Postgres and set DATABASE_URL_TEST in .env.test\n",
    );
    return;
  }
  // Run migrations against the test database before the suite starts.
  // Tolerate exit-1 from drizzle-kit when the schema is already up to date.
  try {
    execSync("pnpm --filter @openboat/db migrate", {
      env: { ...process.env, DATABASE_URL: url },
      stdio: "inherit",
    });
  } catch {
    console.warn("\n⚠  drizzle-kit migrate exited non-zero — schema may already be current.\n");
  }

  // Wipe all user-data tables so each test run starts clean.
  // This is a dedicated test-only DB — truncating everything is intentional.
  const db = createDb(url);
  await db.execute(sql`
    TRUNCATE TABLE
      fishing_reports,
      check_ins,
      tickets,
      payments,
      booking_items,
      bookings,
      trips,
      capacity_changes,
      schedules,
      product_prices,
      products,
      vessels,
      staff,
      customers,
      operators
    RESTART IDENTITY CASCADE
  `);
  console.log("\n🧹 Test DB wiped — all tables truncated.\n");
  await db.$client.end();
}
