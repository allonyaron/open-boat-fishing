import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { platformUsers } from "@openboat/db";
import { db } from "@/lib/db";
import { getPlatformSession, secretTag } from "@/lib/platform-session";
import { checkPassword } from "@/lib/password";
import { checkRateLimit, clientIp, tooManyRequests } from "@/lib/rate-limit";

const bodySchema = z.object({
  email: z.string().min(1).max(200),
  password: z.string().min(1).max(200),
});

// Platform sign-in with a named account (row 12, AR-9). The first account is
// created at /api/platform/auth/setup with PLATFORM_SECRET.
export async function POST(req: NextRequest) {
  // 5 attempts per 15 min per IP.
  const rl = await checkRateLimit(`platform-auth:${clientIp(req)}`, 5, 15 * 60 * 1000);
  if (!rl.allowed) return tooManyRequests(rl.retryAfterSec);

  const tag = secretTag();
  if (!tag) {
    return NextResponse.json({ error: "Platform admin not configured" }, { status: 500 });
  }

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Email and password required" }, { status: 400 });
  }
  const email = parsed.data.email.toLowerCase().trim();

  const [user] = await db
    .select({
      id: platformUsers.id,
      name: platformUsers.name,
      email: platformUsers.email,
      passwordHash: platformUsers.passwordHash,
      active: platformUsers.active,
      sessionVersion: platformUsers.sessionVersion,
    })
    .from(platformUsers)
    .where(eq(platformUsers.email, email));

  // Always compares, so an unknown email takes as long as a wrong password.
  const valid = await checkPassword(parsed.data.password, user?.passwordHash);
  if (!user || !valid) {
    return NextResponse.json({ error: "Invalid credentials" }, { status: 401 });
  }
  if (!user.active) {
    return NextResponse.json({ error: "Account disabled" }, { status: 403 });
  }

  const session = await getPlatformSession();
  session.platformUserId = user.id;
  session.sessionVersion = user.sessionVersion;
  session.secretTag = tag;
  await session.save();

  return NextResponse.json({ name: user.name, email: user.email });
}

export async function DELETE(_req: NextRequest) {
  const session = await getPlatformSession();
  session.destroy();
  return NextResponse.json({ ok: true });
}
