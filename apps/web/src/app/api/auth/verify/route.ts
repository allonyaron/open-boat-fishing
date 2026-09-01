import { NextRequest, NextResponse } from "next/server";
import { compare } from "bcryptjs";
import { db } from "@/lib/db";
import { magicLinkOtps, customers } from "@openboat/db";
import { signCustomerToken } from "@/lib/customer-auth";
import { and, eq, gt, desc } from "drizzle-orm";
import { checkRateLimit, clientIp, tooManyRequests } from "@/lib/rate-limit";
import { getOperatorId } from "@/lib/operator";

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as { email?: string; otp?: string };
  const email = body.email?.toLowerCase().trim();
  const otp = body.otp?.trim();

  if (!email || !otp) {
    return NextResponse.json({ error: "Email and code required" }, { status: 400 });
  }

  // 10 attempts per 15 min per email. OTPs expire in 15 min anyway, so this
  // caps guesses against any single code to 10 without blocking other emails.
  // Coarse IP bucket prevents parallelising across many email addresses from one host.
  const ip = clientIp(req);
  const [ipRl, emailRl] = await Promise.all([
    checkRateLimit(`otp-verify:ip:${ip}`, 20, 15 * 60 * 1000),
    checkRateLimit(`otp-verify:${email}`, 10, 15 * 60 * 1000),
  ]);
  if (!ipRl.allowed || !emailRl.allowed) {
    return tooManyRequests(Math.max(ipRl.retryAfterSec, emailRl.retryAfterSec));
  }

  const operatorId = getOperatorId(req);
  if (!operatorId) return NextResponse.json({ error: "No operator" }, { status: 500 });

  // Find the most recent unused, unexpired OTP for this email
  const [pending] = await db
    .select()
    .from(magicLinkOtps)
    .where(
      and(
        eq(magicLinkOtps.operatorId, operatorId),
        eq(magicLinkOtps.email, email),
        eq(magicLinkOtps.used, false),
        gt(magicLinkOtps.expiresAt, new Date()),
      ),
    )
    .orderBy(desc(magicLinkOtps.createdAt))
    .limit(1);

  if (!pending) {
    return NextResponse.json({ error: "Code expired or not found" }, { status: 401 });
  }

  const valid = await compare(otp, pending.otpHash);
  if (!valid) {
    return NextResponse.json({ error: "Incorrect code" }, { status: 401 });
  }

  // Mark OTP used
  await db.update(magicLinkOtps).set({ used: true }).where(eq(magicLinkOtps.id, pending.id));

  // Find or create customer record
  const [existing] = await db
    .select()
    .from(customers)
    .where(and(eq(customers.operatorId, operatorId), eq(customers.email, email)));

  let customer = existing;
  if (!customer) {
    const [created] = await db
      .insert(customers)
      .values({ operatorId, email })
      .returning();
    customer = created;
  }

  const token = signCustomerToken({
    customerId: customer.id,
    operatorId,
    email: customer.email,
    name: customer.firstName ?? null,
  });

  return NextResponse.json({ token, email: customer.email, name: customer.firstName ?? null });
}
