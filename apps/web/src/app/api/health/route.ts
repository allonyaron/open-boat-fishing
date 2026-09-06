import { NextResponse } from "next/server";
// Importing env triggers the startup validation — throws if any required var is missing.
import "@/lib/env";

export const runtime = "nodejs";
// Never cache: each hit must re-evaluate env and DB at request time.
export const revalidate = 0;

export async function GET() {
  return NextResponse.json({ ok: true });
}
