import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/session";
import { staff, vessels } from "@openboat/db";
import { and, eq } from "drizzle-orm";
import { hash } from "bcryptjs";

export async function PATCH(
  req: NextRequest,
  { params }: { params: { staffId: string } },
) {
  const auth = await requireAdmin(req);
  if (auth instanceof NextResponse) return auth;
  const { session } = auth;

  const { staffId } = params;
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;

  const [member] = await db
    .select({ id: staff.id, role: staff.role })
    .from(staff)
    .where(and(eq(staff.id, staffId), eq(staff.operatorId, session.operatorId)));

  if (!member) return NextResponse.json({ error: "Staff not found" }, { status: 404 });

  // Prevent an admin from deactivating themselves
  if ("active" in body && body.active === false && staffId === session.staffId)
    return NextResponse.json({ error: "Cannot deactivate your own account" }, { status: 400 });

  const patch: Record<string, unknown> = { updatedAt: new Date() };

  if ("name" in body) patch.name = String(body.name).trim();
  if ("active" in body) patch.active = Boolean(body.active);

  if ("vesselId" in body) {
    if (body.vesselId === null) {
      patch.vesselId = null;
    } else {
      const [vessel] = await db
        .select({ id: vessels.id })
        .from(vessels)
        .where(and(eq(vessels.id, String(body.vesselId)), eq(vessels.operatorId, session.operatorId)));
      if (!vessel) return NextResponse.json({ error: "Vessel not found" }, { status: 404 });
      patch.vesselId = vessel.id;
    }
  }

  // Password reset for admins
  if ("password" in body && member.role === "admin") {
    const pw = String(body.password).trim();
    if (pw.length < 8) return NextResponse.json({ error: "Password must be at least 8 characters" }, { status: 400 });
    patch.passwordHash = await hash(pw, 12);
  }

  // PIN reset for mates
  if ("pin" in body && member.role === "mate") {
    const pin = String(body.pin).trim();
    if (!/^\d{4,8}$/.test(pin)) return NextResponse.json({ error: "PIN must be 4–8 digits" }, { status: 400 });
    patch.pinHash = await hash(pin, 12);
  }

  const [updated] = await db
    .update(staff)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .set(patch as any)
    .where(eq(staff.id, staffId))
    .returning({
      id: staff.id,
      name: staff.name,
      email: staff.email,
      role: staff.role,
      vesselId: staff.vesselId,
      active: staff.active,
    });

  return NextResponse.json(updated);
}
