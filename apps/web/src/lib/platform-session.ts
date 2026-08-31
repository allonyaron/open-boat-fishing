import { getIronSession, IronSession } from "iron-session";
import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";

export type PlatformSessionData = {
  authenticated: boolean;
};

const sessionOptions = {
  cookieName: "openboat_platform",
  password: process.env.SESSION_SECRET!,
  cookieOptions: {
    secure: process.env.NODE_ENV === "production",
    httpOnly: true,
    sameSite: "lax" as const,
    maxAge: 60 * 60 * 4, // 4 hours
  },
};

export async function getPlatformSession(): Promise<IronSession<PlatformSessionData>> {
  const cookieStore = await cookies();
  return getIronSession<PlatformSessionData>(cookieStore, sessionOptions);
}

export async function requirePlatform(
  _req: NextRequest,
): Promise<{ session: IronSession<PlatformSessionData> } | NextResponse> {
  const cookieStore = await cookies();
  const session = await getIronSession<PlatformSessionData>(cookieStore, sessionOptions);
  if (!session.authenticated) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return { session };
}
