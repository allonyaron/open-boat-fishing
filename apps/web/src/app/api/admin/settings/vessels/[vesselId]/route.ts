import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/session";
import { recordChange } from "@/lib/audit";
import { vessels } from "@openboat/db";
import { and, eq } from "drizzle-orm";

export async function PATCH(
  req: NextRequest,
  { params }: { params: { vesselId: string } },
) {
  const auth = await requireAdmin(req);
  if (auth instanceof NextResponse) return auth;
  const { session, ctx } = auth;

  const { vesselId } = params;
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;

  const [vessel] = await db
    .select({ id: vessels.id })
    .from(vessels)
    .where(and(eq(vessels.id, vesselId), eq(vessels.operatorId, session.operatorId)));

  if (!vessel) return NextResponse.json({ error: "Vessel not found" }, { status: 404 });

  const allowed = [
    "name", "color", "capacity", "description", "certificateCapacity",
    "groupDiscountThreshold", "groupDiscountPct", "active",
  ] as const;

  const patch: Record<string, unknown> = { updatedAt: new Date() };
  for (const key of allowed) {
    if (key in body) patch[key] = body[key];
  }

  if ("capacity" in patch) {
    const v = Number(patch.capacity);
    if (!Number.isInteger(v) || v < 1)
      return NextResponse.json({ error: "capacity must be a positive integer" }, { status: 400 });
    patch.capacity = v;
  }
  if ("color" in patch && !/^#[0-9a-fA-F]{6}$/.test(String(patch.color)))
    return NextResponse.json({ error: "color must be a hex color" }, { status: 400 });

  const updated = await db.transaction(async (tx) => {
    const [before] = await tx
      .select()
      .from(vessels)
      .where(and(eq(vessels.id, vesselId), eq(vessels.operatorId, session.operatorId)))
      .for("update");
    const [row] = await tx
      .update(vessels)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .set(patch as any)
      .where(and(eq(vessels.id, vesselId), eq(vessels.operatorId, session.operatorId)))
      .returning();
    await recordChange(tx, ctx, {
      operatorId: session.operatorId,
      action: "vessel.update",
      targetTable: "vessels",
      targetId: vesselId,
      before,
      set: patch,
    });
    return row;
  });

  return NextResponse.json(updated);
}
