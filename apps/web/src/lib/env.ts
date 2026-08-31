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
  CRON_SECRET: z.string().min(1),
  RESEND_API_KEY: z.string().min(1),
  // Platform Connect client_id (ca_xxx). Required in centralized mode to generate
  // the Stripe OAuth authorization URL. Not needed in single-deploy mode.
  STRIPE_CLIENT_ID: z.string().optional(),
  // Password protecting the platform admin (/platform). Required in centralized mode.
  PLATFORM_SECRET: z.string().optional(),
  // Marks this deployment as the public demo (openboatfishing.com). Enables the
  // demo banner in the UI and gates the nightly data-reset cron. Any value other
  // than "true" is treated as off.
  DEMO_MODE: z.string().optional(),
  // Public app URL used in transactional emails (e.g. boarding pass link).
  // Omit trailing slash. Falls back to "" in environments where it is not set.
  NEXT_PUBLIC_APP_URL: z.string().optional(),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  const missing = Object.keys(parsed.error.flatten().fieldErrors).join(", ");
  throw new Error(`Missing or invalid environment variables: ${missing}`);
}

export const env = parsed.data;
