import { makeSession } from "@/lib/session-factory";

export type PlatformSessionData = {
  authenticated: boolean;
};

const { getSession: getPlatformSession, requireSession: requirePlatform } =
  makeSession<PlatformSessionData>({
    cookieName: "openboat_platform",
    maxAge: 60 * 60 * 4, // 4 hours
    isAuthorized: (s) => !!s.authenticated,
  });

export { getPlatformSession, requirePlatform };
