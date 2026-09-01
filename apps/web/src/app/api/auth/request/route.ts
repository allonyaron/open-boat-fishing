import { NextRequest, NextResponse } from "next/server";
import { hash } from "bcryptjs";
import { db } from "@/lib/db";
import { magicLinkOtps } from "@openboat/db";
import { and, eq } from "drizzle-orm";
import { sendOtpEmail } from "@/lib/email";
import { getOperatorContext } from "@/lib/operator";
import { checkRateLimit, clientIp, tooManyRequests } from "@/lib/rate-limit";

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as { email?: string };
  const email = body.email?.toLowerCase().trim();

  if (!email || !email.includes("@")) {
    return NextResponse.json({ error: "Valid email required" }, { status: 400 });
  }

  // Rate limit by IP (20/hr) AND email (5/hr) — block if either trips.
  // IP limit uses a wide bucket to avoid locking out NAT'd users; email limit
  // is tight because each hit costs a transactional email send.
  const ip = clientIp(req);
  const [ipRl, emailRl] = await Promise.all([
    checkRateLimit(`otp-request:ip:${ip}`, 20, 60 * 60 * 1000),
    checkRateLimit(`otp-request:email:${email}`, 5, 60 * 60 * 1000),
  ]);
  if (!ipRl.allowed || !emailRl.allowed) {
    return tooManyRequests(Math.max(ipRl.retryAfterSec, emailRl.retryAfterSec));
  }

  const operator = await getOperatorContext(req);
  if (!operator) return NextResponse.json({ error: "No operator" }, { status: 500 });

  // Generate 6-digit OTP
  const otp = String(Math.floor(100000 + Math.random() * 900000));
  const otpHash = await hash(otp, 10);
  const expiresAt = new Date(Date.now() + 15 * 60 * 1000);

  // Invalidate any unused OTPs for this email+operator before issuing a new one.
  // Prevents an intercepted old code from being valid after the user requests a fresh one.
  await db
    .update(magicLinkOtps)
    .set({ used: true })
    .where(
      and(
        eq(magicLinkOtps.operatorId, operator.id),
        eq(magicLinkOtps.email, email),
        eq(magicLinkOtps.used, false),
      ),
    );

  await db.insert(magicLinkOtps).values({
    operatorId: operator.id,
    email,
    otpHash,
    expiresAt,
  });

  try {
    await sendOtpEmail({
      to: email,
      otp,
      operatorName: operator.name,
      fromAddress: operator.emailFrom,
    });
  } catch (err) {
    console.error("OTP email failed:", err);
    return NextResponse.json({ error: "Failed to send code. Try again." }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
