import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./src/schema.ts",
  out: "./migrations",
  dialect: "postgresql",
  dbCredentials: {
    // Prefer DIRECT_DATABASE_URL (non-pooler) for migrations — PgBouncer can
    // interfere with migration transactions. Falls back to DATABASE_URL in local dev.
    url: (process.env.DIRECT_DATABASE_URL ?? process.env.DATABASE_URL)!,
  },
});
