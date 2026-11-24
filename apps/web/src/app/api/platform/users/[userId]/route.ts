import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { eq, sql } from "drizzle-orm";
import { platformUsers } from "@openboat/db";
import { db } from "@/lib/db";
import { changedFields, recordAudit } from "@/lib/audit";
import { requirePlatform } from "@/lib/platform-session";
import { hashPassword, PASSWORD_MIN_LENGTH } from "@/lib/password";

const patchSchema = z
  .object({
    name: z.string().trim().min(1).max(100).optional(),
    active: z.boolean().optional(),
    password: z.string().min(PASSWORD_MIN_LENGTH).max(200).optional(),
  })
  .strict();

// Renames, deactivates or reactivates a platform account, or sets its
// password. Deactivating it or setting a password ends its sessions.
export async function PATCH(req: NextRequest, { params }: { params: { userId: string } }) {
  const auth = await requirePlatform(req);
  if (auth instanceof NextResponse) return auth;
  const { session, ctx } = auth;
  const { userId } = params;

  const parsed = patchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request", detail: parsed.error.flatten().fieldErrors },
      { status: 400 },
    );
  }
  const body = parsed.data;
  if (body.active === false && userId === session.platformUserId) {
    return NextResponse.json({ error: "Cannot deactivate your own account" }, { status: 400 });
  }

  const patch: Partial<typeof platformUsers.$inferInsert> = {};
  if (body.name !== undefined) patch.name = body.name;
  if (body.active !== undefined) patch.active = body.active;
  if (body.password !== undefined) patch.passwordHash = await hashPassword(body.password);

  const updated = await db.transaction(async (tx) => {
    const [before] = await tx
      .select({ name: platformUsers.name, active: platformUsers.active, passwordHash: platformUsers.passwordHash })
      .from(platformUsers)
      .where(eq(platformUsers.id, userId))
      .for("update");
    if (!before) return null;
    const endsSessions = (patch.active === false && before.active) || patch.passwordHash !== undefined;

    const [row] = await tx
      .update(platformUsers)
      .set({
        ...patch,
        ...(endsSessions && { sessionVersion: sql`${platformUsers.sessionVersion} + 1` }),
        updatedAt: ctx.now,
      })
      .where(eq(platformUsers.id, userId))
      .returning({
        id: platformUsers.id,
        name: platformUsers.name,
        email: platformUsers.email,
        active: platformUsers.active,
        sessionVersion: platformUsers.sessionVersion,
      });
    const diff = changedFields(before, patch);
    if (Object.keys(diff.after).length > 0) {
      await recordAudit(tx, ctx, {
        operatorId: null,
        action: "platform_user.update",
        targetTable: "platform_users",
        targetId: userId,
        ...diff,
      });
    }
    return row;
  });
  if (!updated) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const { sessionVersion, ...user } = updated;
  // Setting your own password keeps this browser signed in.
  if (userId === session.platformUserId && sessionVersion !== session.sessionVersion) {
    session.sessionVersion = sessionVersion;
    await session.save();
  }
  return NextResponse.json(user);
}
