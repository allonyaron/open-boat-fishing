import { randomUUID } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { sql } from "drizzle-orm";
import { platformUsers } from "@openboat/db";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { createdFields, recordAudit } from "@/lib/audit";
import { getPlatformSession, sameSecret, secretTag } from "@/lib/platform-session";
import { hashPassword, PASSWORD_MIN_LENGTH } from "@/lib/password";
import { checkRateLimit, clientIp, tooManyRequests } from "@/lib/rate-limit";
import { requestContext } from "@/lib/request-context";

const bodySchema = z.object({
  secret: z.string().min(1).max(500),
  name: z.string().trim().min(1).max(100),
  email: z.string().trim().toLowerCase().email().max(200),
  password: z.string().min(PASSWORD_MIN_LENGTH).max(200),
});

// Creates the first platform account (row 12). PLATFORM_SECRET is accepted
// here only while no account exists; after that, accounts are added by a
// signed-in platform user.
export async function POST(req: NextRequest) {
  // 5 attempts per 15 min per IP: the secret is what this guards.
  const rl = await checkRateLimit(`platform-setup:${clientIp(req)}`, 5, 15 * 60 * 1000);
  if (!rl.allowed) return tooManyRequests(rl.retryAfterSec);

  const tag = secretTag();
  if (!tag || !env.PLATFORM_SECRET) {
    return NextResponse.json({ error: "Platform admin not configured" }, { status: 500 });
  }

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request", detail: parsed.error.flatten().fieldErrors },
      { status: 400 },
    );
  }
  const { secret, name, email, password } = parsed.data;
  if (!sameSecret(secret, env.PLATFORM_SECRET)) {
    return NextResponse.json({ error: "Invalid secret" }, { status: 401 });
  }

  const passwordHash = await hashPassword(password);
  const id = randomUUID();
  // The new user is the actor: the person holding the secret, now named.
  const ctx = requestContext(req, { kind: "platform", platformUserId: id });

  // Under a lock, so two setups at once can't both create a first account.
  const created = await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('platform_users:first'))`);
    const [{ count }] = await tx.select({ count: sql<number>`count(*)::int` }).from(platformUsers);
    if (count > 0) return null;
    const [user] = await tx
      .insert(platformUsers)
      .values({ id, name, email, passwordHash })
      .returning({ id: platformUsers.id, name: platformUsers.name, email: platformUsers.email, sessionVersion: platformUsers.sessionVersion });
    await recordAudit(tx, ctx, {
      operatorId: null,
      action: "platform_user.create",
      targetTable: "platform_users",
      targetId: user.id,
      after: createdFields({ name, email, active: true }),
      reason: "First platform account, created with PLATFORM_SECRET",
    });
    return user;
  });
  if (!created) {
    return NextResponse.json(
      { error: "The first platform account already exists. Sign in instead." },
      { status: 409 },
    );
  }

  const session = await getPlatformSession();
  session.platformUserId = created.id;
  session.sessionVersion = created.sessionVersion;
  session.secretTag = tag;
  await session.save();

  return NextResponse.json({ name: created.name, email: created.email }, { status: 201 });
}
