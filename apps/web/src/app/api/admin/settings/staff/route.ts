import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/session";
import { staff, vessels } from "@openboat/db";
import { and, eq } from "drizzle-orm";
import { hash } from "bcryptjs";

export async function GET(req: NextRequest) {
  const auth = await requireAdmin(req);
  if (auth instanceof NextResponse) return auth;
  const { session } = auth;

  const rows = await db
    .select({
      id: staff.id,
      name: staff.name,
      email: staff.email,
      role: staff.role,
      vesselId: staff.vesselId,
      active: staff.active,
      createdAt: staff.createdAt,
    })
    .from(staff)
    .where(eq(staff.operatorId, session.operatorId))
    .orderBy(staff.role, staff.name);

  return NextResponse.json(rows);
}

export async function POST(req: NextRequest) {
  const auth = await requireAdmin(req);
  if (auth instanceof NextResponse) return auth;
  const { session } = auth;

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;

  const name = String(body.name ?? "").trim();
  const email = String(body.email ?? "").toLowerCase().trim();
  const role = String(body.role ?? "") as "admin" | "mate";

  if (!name) return NextResponse.json({ error: "name is required" }, { status: 400 });
  if (!email || !email.includes("@")) return NextResponse.json({ error: "valid email is required" }, { status: 400 });
  if (role !== "admin" && role !== "mate") return NextResponse.json({ error: "role must be admin or mate" }, { status: 400 });

  const values: Record<string, unknown> = {
    operatorId: session.operatorId,
    name,
    email,
    role,
    active: true,
  };

  if (role === "admin") {
    const password = String(body.password ?? "").trim();
    if (password.length < 8) return NextResponse.json({ error: "Admin password must be at least 8 characters" }, { status: 400 });
    values.passwordHash = await hash(password, 12);
  } else {
    const pin = String(body.pin ?? "").trim();
    if (!/^\d{4,8}$/.test(pin)) return NextResponse.json({ error: "Mate PIN must be 4–8 digits" }, { status: 400 });
    values.pinHash = await hash(pin, 12);

    if (body.vesselId) {
      const [vessel] = await db
        .select({ id: vessels.id })
        .from(vessels)
        .where(and(eq(vessels.id, String(body.vesselId)), eq(vessels.operatorId, session.operatorId)));
      if (!vessel) return NextResponse.json({ error: "Vessel not found" }, { status: 404 });
      values.vesselId = vessel.id;
    }
  }

  const [row] = await db
    .insert(staff)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .values(values as any)
    .returning({
      id: staff.id,
      name: staff.name,
      email: staff.email,
      role: staff.role,
      vesselId: staff.vesselId,
      active: staff.active,
      createdAt: staff.createdAt,
    })
    .catch((err: Error) => {
      if (err.message.includes("unique"))
        throw Object.assign(new Error("Email already exists"), { code: "CONFLICT" });
      throw err;
    });

  return NextResponse.json(row, { status: 201 });
}
