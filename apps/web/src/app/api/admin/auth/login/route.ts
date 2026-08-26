import { NextRequest, NextResponse } from "next/server";
import { compare } from "bcryptjs";
import { db } from "@/lib/db";
import { staff } from "@openboat/db";
import { eq } from "drizzle-orm";
import { getSession } from "@/lib/session";
import { checkRateLimit, clientIp, tooManyRequests } from "@/lib/rate-limit";
import { getOperatorId } from "@/lib/operator";

export async function POST(req: NextRequest) {
  const { email, password } = await req.json();

  if (!email || !password) {
    return NextResponse.json({ error: "Email and password required" }, { status: 400 });
  }

  // 10 attempts per 15 min per IP. Admin login is low-volume and high-value —
  // any legitimate operator will never hit this.
  const rl = await checkRateLimit(`admin-login:${clientIp(req)}`, 10, 15 * 60 * 1000);
  if (!rl.allowed) return tooManyRequests(rl.retryAfterSec);

  const operatorId = getOperatorId(req);
  if (!operatorId) {
    return NextResponse.json({ error: "No operator configured" }, { status: 500 });
  }

  const [member] = await db.select().from(staff).where(eq(staff.email, email.toLowerCase().trim()));

  if (!member || !member.passwordHash || member.operatorId !== operatorId) {
    return NextResponse.json({ error: "Invalid credentials" }, { status: 401 });
  }

  if (member.role !== "admin") {
    return NextResponse.json({ error: "Admin access required" }, { status: 403 });
  }

  if (!member.active) {
    return NextResponse.json({ error: "Account disabled" }, { status: 403 });
  }

  const valid = await compare(password, member.passwordHash);
  if (!valid) {
    return NextResponse.json({ error: "Invalid credentials" }, { status: 401 });
  }

  const session = await getSession();
  session.staffId = member.id;
  session.operatorId = member.operatorId;
  session.role = member.role;
  session.name = member.name;
  await session.save();

  return NextResponse.json({ name: member.name, role: member.role });
}
