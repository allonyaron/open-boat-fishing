import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
// Importing env triggers the startup validation — throws if any required var is missing.
import "@/lib/env";
import { db } from "@/lib/db";

export const runtime = "nodejs";
// Never cache: each hit must re-evaluate env and DB at request time.
export const revalidate = 0;

// postgres-js waits ~30s for a connection by default; a health check should
// fail fast so CI and uptime monitors see an unreachable DB as a 503.
const DB_TIMEOUT_MS = 3_000;

export async function GET() {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      db.execute(sql`select 1`),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error("DB check timed out")), DB_TIMEOUT_MS);
      }),
    ]);
  } catch (err) {
    // Log server-side only — this endpoint is public, so the body stays generic.
    console.error("[health] DB check failed", err);
    return NextResponse.json({ ok: false }, { status: 503 });
  } finally {
    clearTimeout(timer);
  }
  return NextResponse.json({ ok: true });
}
