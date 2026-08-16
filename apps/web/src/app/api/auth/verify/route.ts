import { NextRequest, NextResponse } from "next/server";
import { compare } from "bcryptjs";
import { db } from "@/lib/db";
import { operators, magicLinkOtps, customers } from "@openboat/db";
import { signCustomerToken } from "@/lib/customer-auth";
import { and, eq, gt, desc } from "drizzle-orm";

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as { email?: string; otp?: string };
  const email = body.email?.toLowerCase().trim();
  const otp = body.otp?.trim();

  if (!email || !otp) {
    return NextResponse.json({ error: "Email and code required" }, { status: 400 });
  }

  const [operator] = await db.select().from(operators).limit(1);
  if (!operator) return NextResponse.json({ error: "No operator" }, { status: 500 });

  // Find the most recent unused, unexpired OTP for this email
  const [pending] = await db
    .select()
    .from(magicLinkOtps)
    .where(
      and(
        eq(magicLinkOtps.operatorId, operator.id),
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
    .where(and(eq(customers.operatorId, operator.id), eq(customers.email, email)));

  let customer = existing;
  if (!customer) {
    const [created] = await db
      .insert(customers)
      .values({ operatorId: operator.id, email })
      .returning();
    customer = created;
  }

  const token = signCustomerToken({
    customerId: customer.id,
    operatorId: operator.id,
    email: customer.email,
    name: customer.firstName ?? null,
  });

  return NextResponse.json({ token, email: customer.email, name: customer.firstName ?? null });
}
