import { NextRequest, NextResponse } from "next/server";
import { getPlatformSession } from "@/lib/platform-session";
import { env } from "@/lib/env";

export async function POST(req: NextRequest) {
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
