import { execSync } from "child_process";
import { createDb } from "@openboat/db";
import { sql } from "drizzle-orm";

export async function setup() {
  const url = process.env.DATABASE_URL_TEST;
  if (!url) {
    // In CI a missing test DB would skip every integration test and still go
    // green — fail instead.
    if (process.env.CI) {
      throw new Error("DATABASE_URL_TEST must be set in CI — integration tests would be skipped");
    }
    console.warn(
      "\n⚠  DATABASE_URL_TEST not set — integration tests that hit the DB will be skipped.\n" +
        "   Create a Neon branch or local Postgres and set DATABASE_URL_TEST in .env.test\n",
    );
    return;
  }
  // Run migrations against the test database before the suite starts.
  // drizzle-kit exits 0 when the schema is already current, so a non-zero exit
  // is a real migration failure — let it fail the run.
  execSync("pnpm --filter @openboat/db migrate", {
    env: { ...process.env, DATABASE_URL: url, DATABASE_URL_UNPOOLED: undefined },
    stdio: "inherit",
  });

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
      operators,
      rate_limits
    RESTART IDENTITY CASCADE
  `);
  console.log("\n🧹 Test DB wiped — all tables truncated.\n");
  await db.$client.end();
}
