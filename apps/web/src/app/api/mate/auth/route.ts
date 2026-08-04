import { NextRequest, NextResponse } from "next/server";
import { compare } from "bcryptjs";
import { db } from "@/lib/db";
import { staff, operators } from "@openboat/db";
import { eq } from "drizzle-orm";
import { signMateToken } from "@/lib/mate-auth";

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({})) as { email?: string; pin?: string };
  const { email, pin } = body;

  if (!email || !pin) {
    return NextResponse.json({ error: "Email and PIN required" }, { status: 400 });
  }

  const [operator] = await db.select().from(operators).limit(1);
  if (!operator) {
    return NextResponse.json({ error: "No operator configured" }, { status: 500 });
  }

  const [member] = await db
    .select()
    .from(staff)
    .where(eq(staff.email, email.toLowerCase().trim()));

  if (!member || member.operatorId !== operator.id) {
    return NextResponse.json({ error: "Invalid credentials" }, { status: 401 });
  }

  if (!member.pinHash) {
    return NextResponse.json({ error: "No PIN configured for this account" }, { status: 401 });
  }

  if (!member.active) {
    return NextResponse.json({ error: "Account disabled" }, { status: 403 });
  }

  if (member.role !== "mate" && member.role !== "admin") {
    return NextResponse.json({ error: "Mate or admin role required" }, { status: 403 });
  }

  const valid = await compare(pin, member.pinHash);
  if (!valid) {
    return NextResponse.json({ error: "Invalid credentials" }, { status: 401 });
  }

  const token = signMateToken({
    staffId: member.id,
    operatorId: member.operatorId,
    role: member.role,
    name: member.name,
  });

  return NextResponse.json({ token, name: member.name, role: member.role });
}
