/**
 * Validates required environment variables at module load time.
 * Import this file (or any lib that imports it) early so missing vars
 * produce a clear error at startup instead of a cryptic 500 at request time.
 */
import { z } from "zod";

const envSchema = z.object({
  DATABASE_URL: z.string().min(1),
  SESSION_SECRET: z.string().min(32),
  STRIPE_SECRET_KEY: z.string().min(1),
  STRIPE_WEBHOOK_SECRET: z.string().min(1),
  STRIPE_CONNECTED_ACCOUNT_ID: z.string().min(1),
  CRON_SECRET: z.string().min(1),
  RESEND_API_KEY: z.string().min(1),
  // Marks this deployment as the public demo (openboatfishing.com). Enables the
  // demo banner in the UI and gates the nightly data-reset cron. Any value other
  // than "true" is treated as off.
  DEMO_MODE: z.string().optional(),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  const missing = Object.keys(parsed.error.flatten().fieldErrors).join(", ");
  throw new Error(`Missing or invalid environment variables: ${missing}`);
}

export const env = parsed.data;
