import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./src/schema.ts",
  out: "./migrations",
  dialect: "postgresql",
  dbCredentials: {
    // Prefer a direct (non-pooler) URL for migrations — PgBouncer can interfere
    // with migration transactions. DATABASE_URL_UNPOOLED is set per environment
    // (including each preview branch) by the Neon ↔ Vercel integration. Falls
    // back to DATABASE_URL in local dev.
    url: (process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL)!,
  },
});
