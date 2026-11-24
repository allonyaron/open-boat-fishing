import { createHmac, timingSafeEqual } from "crypto";
import { eq } from "drizzle-orm";
import { platformUsers } from "@openboat/db";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { makeSession } from "@/lib/session-factory";

export type PlatformSessionData = {
  platformUserId: string;
  /** platform_users.session_version at sign-in. */
  sessionVersion: number;
  /** secretTag() of the PLATFORM_SECRET the session was issued under. */
  secretTag: string;
};

/**
 * A keyed fingerprint of the current PLATFORM_SECRET, sealed into each
 * platform session: changing the secret signs every platform user out
 * (row 12, P5-1 item 4). Null when the console is off.
 */
export function secretTag(): string | null {
  if (!env.PLATFORM_SECRET) return null;
  return createHmac("sha256", env.SESSION_SECRET)
    .update(`platform-session:${env.PLATFORM_SECRET}`)
    .digest("base64url");
}

export function sameSecret(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

const { getSession: getPlatformSession, requireSession: requirePlatform } =
  makeSession<PlatformSessionData>({
    cookieName: "openboat_platform",
    maxAge: 60 * 60 * 4, // 4 hours
    // Every platform request re-checks the account (row 12): the console is
    // on, the session was issued under the current PLATFORM_SECRET, and the
    // user is still active with the same session version.
    authorize: async (s) => {
      const tag = secretTag();
      if (!tag || !s.platformUserId || typeof s.sessionVersion !== "number" || !s.secretTag) return null;
      if (!sameSecret(s.secretTag, tag)) return null;
      const [user] = await db
        .select({ active: platformUsers.active, sessionVersion: platformUsers.sessionVersion })
        .from(platformUsers)
        .where(eq(platformUsers.id, s.platformUserId));
      if (!user || !user.active || user.sessionVersion !== s.sessionVersion) return null;
      return { kind: "platform", platformUserId: s.platformUserId };
    },
  });

export { getPlatformSession, requirePlatform };
