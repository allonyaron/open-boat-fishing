import { execSync } from "child_process";

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
  execSync("pnpm --filter @openboat/db migrate", {
    env: { ...process.env, DATABASE_URL: url },
    stdio: "inherit",
  });
}
