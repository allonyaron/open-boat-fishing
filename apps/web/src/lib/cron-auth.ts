import { timingSafeEqual } from "crypto";
import { env } from "@/lib/env";

export function verifyCronAuth(authHeader: string | null): boolean {
  const secret = env.CRON_SECRET;
  if (!authHeader || !secret) return false;
  const expected = `Bearer ${secret}`;
  try {
    return (
      authHeader.length === expected.length &&
      timingSafeEqual(Buffer.from(authHeader), Buffer.from(expected))
    );
  } catch {
    return false;
  }
}
