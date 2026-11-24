import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { platformUsers } from "@openboat/db";
import { db } from "@/lib/db";
import { createdFields, recordAudit } from "@/lib/audit";
import { requirePlatform } from "@/lib/platform-session";
import { hashPassword, PASSWORD_MIN_LENGTH } from "@/lib/password";

const createSchema = z.object({
  name: z.string().trim().min(1).max(100),
  email: z.string().trim().toLowerCase().email().max(200),
  password: z.string().min(PASSWORD_MIN_LENGTH).max(200),
});

const publicFields = {
  id: platformUsers.id,
  name: platformUsers.name,
  email: platformUsers.email,
  active: platformUsers.active,
  createdAt: platformUsers.createdAt,
};

export async function GET(req: NextRequest) {
  const auth = await requirePlatform(req);
  if (auth instanceof NextResponse) return auth;

  const rows = await db.select(publicFields).from(platformUsers).orderBy(platformUsers.createdAt);
  return NextResponse.json(rows);
}

// Adds a platform account. Any signed-in platform user can.
export async function POST(req: NextRequest) {
  const auth = await requirePlatform(req);
  if (auth instanceof NextResponse) return auth;
  const { ctx } = auth;

  const parsed = createSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request", detail: parsed.error.flatten().fieldErrors },
      { status: 400 },
    );
  }
  const { name, email, password } = parsed.data;
  const passwordHash = await hashPassword(password);

  const user = await db.transaction(async (tx) => {
    const [row] = await tx
      .insert(platformUsers)
      .values({ name, email, passwordHash })
      .onConflictDoNothing({ target: platformUsers.email })
      .returning(publicFields);
    if (!row) return null;
    await recordAudit(tx, ctx, {
      operatorId: null,
      action: "platform_user.create",
      targetTable: "platform_users",
      targetId: row.id,
      after: createdFields({ name, email, active: true }),
    });
    return row;
  });
  if (!user) return NextResponse.json({ error: "Email already exists" }, { status: 409 });

  return NextResponse.json(user, { status: 201 });
}
