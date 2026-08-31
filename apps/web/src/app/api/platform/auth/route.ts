import { NextRequest, NextResponse } from "next/server";
import { getPlatformSession } from "@/lib/platform-session";
import { env } from "@/lib/env";
import { checkRateLimit, clientIp, tooManyRequests } from "@/lib/rate-limit";

export async function POST(req: NextRequest) {
  // 5 attempts per 15 min per IP — brute-forcing PLATFORM_SECRET must be infeasible
  const rl = await checkRateLimit(`platform-auth:${clientIp(req)}`, 5, 15 * 60 * 1000);
  if (!rl.allowed) return tooManyRequests(rl.retryAfterSec);

  const { secret } = await req.json();

  if (!env.PLATFORM_SECRET) {
    return NextResponse.json({ error: "Platform admin not configured" }, { status: 500 });
  }

  if (!secret || secret !== env.PLATFORM_SECRET) {
    return NextResponse.json({ error: "Invalid secret" }, { status: 401 });
  }

  const session = await getPlatformSession();
  session.authenticated = true;
  await session.save();

  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: NextRequest) {
  const session = await getPlatformSession();
  session.destroy();
  return NextResponse.json({ ok: true });
}
