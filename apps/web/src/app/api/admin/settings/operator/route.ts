import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/session";
import { operators } from "@openboat/db";
import { eq } from "drizzle-orm";

export async function GET(req: NextRequest) {
  const auth = await requireAdmin(req);
  if (auth instanceof NextResponse) return auth;
  const { session } = auth;

  const [op] = await db
    .select()
    .from(operators)
    .where(eq(operators.id, session.operatorId));

  if (!op) return NextResponse.json({ error: "Operator not found" }, { status: 404 });
  return NextResponse.json(op);
}

export async function PATCH(req: NextRequest) {
  const auth = await requireAdmin(req);
  if (auth instanceof NextResponse) return auth;
  const { session } = auth;

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;

  const allowed = [
    "name", "emailFrom", "emailDomain", "phone", "dockAddress", "dockMapsUrl",
    "arriveMinutesBefore", "termsUrl", "twilioFromNumber", "feeBearer", "feeDisplay",
    "cancelWindowHrs", "settleGraceHrs",
  ] as const;

  const patch: Record<string, unknown> = { updatedAt: new Date() };
  for (const key of allowed) {
    if (key in body) patch[key] = body[key];
  }

  if ("arriveMinutesBefore" in patch) {
    const v = patch.arriveMinutesBefore;
    if (v === null || v === "" || v === undefined) {
      patch.arriveMinutesBefore = null;
    } else {
      const n = Number(v);
      if (!Number.isInteger(n) || n < 1)
        return NextResponse.json({ error: "arriveMinutesBefore must be a positive integer" }, { status: 400 });
      patch.arriveMinutesBefore = n;
    }
  }
  if ("cancelWindowHrs" in patch) {
    const v = Number(patch.cancelWindowHrs);
    if (!Number.isInteger(v) || v < 0)
      return NextResponse.json({ error: "cancelWindowHrs must be a non-negative integer" }, { status: 400 });
    patch.cancelWindowHrs = v;
  }
  if ("settleGraceHrs" in patch) {
    const v = Number(patch.settleGraceHrs);
    if (!Number.isInteger(v) || v < 0)
      return NextResponse.json({ error: "settleGraceHrs must be a non-negative integer" }, { status: 400 });
    patch.settleGraceHrs = v;
  }

  const [updated] = await db
    .update(operators)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .set(patch as any)
    .where(eq(operators.id, session.operatorId))
    .returning();

  return NextResponse.json(updated);
}
