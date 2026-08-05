import { NextRequest, NextResponse } from "next/server";
import { hash } from "bcryptjs";
import { db } from "@/lib/db";
import { operators, magicLinkOtps } from "@openboat/db";
import { sendOtpEmail } from "@/lib/email";
import { eq } from "drizzle-orm";

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({})) as { email?: string };
  const email = body.email?.toLowerCase().trim();

  if (!email || !email.includes("@")) {
    return NextResponse.json({ error: "Valid email required" }, { status: 400 });
  }

  const [operator] = await db.select().from(operators).limit(1);
  if (!operator) return NextResponse.json({ error: "No operator" }, { status: 500 });

  // Generate 6-digit OTP
  const otp = String(Math.floor(100000 + Math.random() * 900000));
  const otpHash = await hash(otp, 10);
  const expiresAt = new Date(Date.now() + 15 * 60 * 1000);

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
