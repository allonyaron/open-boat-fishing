import { db } from "@/lib/db";
import { sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

export function clientIp(req: NextRequest): string {
  return req.headers.get("x-forwarded-for")?.split(",")[0].trim() ?? "unknown";
}

/**
 * Fixed-window counter backed by Postgres. Atomic via ON CONFLICT DO UPDATE —
 * Postgres holds a row lock on the primary key across the CASE evaluation and
 * the write, so concurrent requests serialize correctly.
 *
 * Returns allowed=false once count exceeds max; retryAfterSec is seconds until
 * the current window expires.
 */
export async function checkRateLimit(
  key: string,
  max: number,
  windowMs: number,
): Promise<{ allowed: boolean; retryAfterSec: number }> {
  const windowSec = Math.ceil(windowMs / 1000);

  const result = await db.execute(sql`
    INSERT INTO rate_limits (key, count, window_start)
    VALUES (${key}, 1, NOW())
    ON CONFLICT (key) DO UPDATE SET
      count = CASE
        WHEN EXTRACT(EPOCH FROM (NOW() - rate_limits.window_start)) > ${windowSec}
          THEN 1
        ELSE rate_limits.count + 1
      END,
      window_start = CASE
        WHEN EXTRACT(EPOCH FROM (NOW() - rate_limits.window_start)) > ${windowSec}
          THEN NOW()
        ELSE rate_limits.window_start
      END
    RETURNING count, window_start
  `);

  // postgres.js driver returns rows directly as the array (no .rows wrapper)
  const row = result[0] as { count: number; window_start: string };
  if (row.count > max) {
    const windowEndMs = new Date(row.window_start).getTime() + windowMs;
    const retryAfterSec = Math.ceil(Math.max(0, windowEndMs - Date.now()) / 1000);
    return { allowed: false, retryAfterSec };
  }
  return { allowed: true, retryAfterSec: 0 };
}

/** Reset a rate-limit bucket on successful auth (used by booking lookup). */
export async function resetRateLimit(key: string): Promise<void> {
  await db.execute(sql`DELETE FROM rate_limits WHERE key = ${key}`);
}

export function tooManyRequests(retryAfterSec: number) {
  return NextResponse.json(
    { error: "Too many requests. Please try again later." },
    { status: 429, headers: { "Retry-After": String(retryAfterSec) } },
  );
}
