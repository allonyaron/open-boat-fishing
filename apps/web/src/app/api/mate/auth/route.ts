import { NextRequest, NextResponse } from "next/server";
import { compare } from "bcryptjs";
import { db } from "@/lib/db";
import { staff } from "@openboat/db";
import { and, eq } from "drizzle-orm";
import { signMateToken } from "@/lib/mate-auth";
import { checkRateLimit, tooManyRequests } from "@/lib/rate-limit";
import { getOperatorId } from "@/lib/operator";

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as { email?: string; pin?: string };
  const { email, pin } = body;

  if (!email || !pin) {
    return NextResponse.json({ error: "Email and PIN required" }, { status: 400 });
  }

  // 4-digit PIN = 10,000 combinations. 5 per 15 min caps a sustained attack
  // to ~480 guesses/day — ~21 days to brute-force without a lockout signal.
  const rl = await checkRateLimit(`mate-auth:${email.toLowerCase().trim()}`, 5, 15 * 60 * 1000);
  if (!rl.allowed) return tooManyRequests(rl.retryAfterSec);

  const operatorId = getOperatorId(req);
  if (!operatorId) {
    return NextResponse.json({ error: "No operator configured" }, { status: 500 });
  }

  const [member] = await db
    .select()
    .from(staff)
    .where(and(eq(staff.email, email.toLowerCase().trim()), eq(staff.operatorId, operatorId)));

  // Always run compare() to prevent timing attacks that reveal valid emails.
  // DUMMY_HASH is a bcrypt hash of the empty string — compare() takes the same
  // time regardless of whether a real hash or this sentinel is passed.
  const DUMMY_HASH = "$2b$10$X9WQFa2V6Hv1Z3KlMxrp7O3Tz8eN0yBs4kHjXc7LdPqAw5tUvRxG";
  const hashToCompare = member?.pinHash ?? DUMMY_HASH;
  const valid = await compare(pin, hashToCompare);

  if (!member || !member.pinHash || !valid) {
    return NextResponse.json({ error: "Invalid credentials" }, { status: 401 });
  }

  if (!member.active) {
    return NextResponse.json({ error: "Account disabled" }, { status: 403 });
  }

  if (member.role !== "mate" && member.role !== "admin") {
    return NextResponse.json({ error: "Mate or admin role required" }, { status: 403 });
  }

  const token = signMateToken({
    staffId: member.id,
    operatorId: member.operatorId,
    role: member.role,
    name: member.name,
  });

  return NextResponse.json({ token, name: member.name, role: member.role });
}
