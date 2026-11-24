import { makeSession } from "@/lib/session-factory";

export type PlatformSessionData = {
  authenticated: boolean;
};

const { getSession: getPlatformSession, requireSession: requirePlatform } =
  makeSession<PlatformSessionData>({
    cookieName: "openboat_platform",
    maxAge: 60 * 60 * 4, // 4 hours
    // Replaced by named platform accounts later in row 12.
    authorize: async (s) => (s.authenticated ? { kind: "platform", platformUserId: "platform-secret" } : null),
  });

export { getPlatformSession, requirePlatform };
