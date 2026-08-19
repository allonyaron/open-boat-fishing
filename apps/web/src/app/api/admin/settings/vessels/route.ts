import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/session";
import { vessels } from "@openboat/db";
import { eq } from "drizzle-orm";

function toSlug(name: string) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

export async function GET(req: NextRequest) {
  const auth = await requireAdmin(req);
  if (auth instanceof NextResponse) return auth;
  const { session } = auth;

  const rows = await db
    .select()
    .from(vessels)
    .where(eq(vessels.operatorId, session.operatorId))
    .orderBy(vessels.createdAt);

  return NextResponse.json(rows);
}

export async function POST(req: NextRequest) {
  const auth = await requireAdmin(req);
  if (auth instanceof NextResponse) return auth;
  const { session } = auth;

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;

  const name = String(body.name ?? "").trim();
  if (!name) return NextResponse.json({ error: "name is required" }, { status: 400 });

  const capacity = Number(body.capacity);
  if (!Number.isInteger(capacity) || capacity < 1)
    return NextResponse.json({ error: "capacity must be a positive integer" }, { status: 400 });

  const color = String(body.color ?? "#1D4ED8").trim();
  if (!/^#[0-9a-fA-F]{6}$/.test(color))
    return NextResponse.json({ error: "color must be a hex color (e.g. #1D4ED8)" }, { status: 400 });

  const slug = body.slug ? String(body.slug).trim() : toSlug(name);

  const patch: Record<string, unknown> = {
    operatorId: session.operatorId,
    name,
    slug,
    color,
    capacity,
  };

  if (body.description) patch.description = String(body.description);
  if (body.certificateCapacity != null) {
    const cc = Number(body.certificateCapacity);
    if (Number.isInteger(cc) && cc > 0) patch.certificateCapacity = cc;
  }
  if (body.groupDiscountThreshold != null && body.groupDiscountPct != null) {
    patch.groupDiscountThreshold = Number(body.groupDiscountThreshold);
    patch.groupDiscountPct = Number(body.groupDiscountPct);
  }

  const [row] = await db
    .insert(vessels)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .values(patch as any)
    .returning()
    .catch((err: Error) => {
      if (err.message.includes("unique")) throw Object.assign(err, { code: "CONFLICT" });
      throw err;
    });

  return NextResponse.json(row, { status: 201 });
}
