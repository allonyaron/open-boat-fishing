import { NextRequest, NextResponse } from "next/server";
import { eq, sql } from "drizzle-orm";
import { platformUsers } from "@openboat/db";
import { db } from "@/lib/db";
import { requirePlatform, secretTag } from "@/lib/platform-session";

// Who is signed in to the platform console. When nobody is, says whether the
// console is on and whether its first account still has to be created, so
// the page can show the right form.
export async function GET(req: NextRequest) {
  const auth = await requirePlatform(req);
  if (auth instanceof NextResponse) {
    const configured = secretTag() !== null;
    const [{ count }] = configured
      ? await db.select({ count: sql<number>`count(*)::int` }).from(platformUsers)
      : [{ count: 0 }];
    return NextResponse.json(
      { error: "Unauthorized", configured, needsFirstAccount: configured && count === 0 },
      { status: 401 },
    );
  }

  const [user] = await db
    .select({ id: platformUsers.id, name: platformUsers.name, email: platformUsers.email })
    .from(platformUsers)
    .where(eq(platformUsers.id, auth.session.platformUserId));
  return NextResponse.json(user);
}
