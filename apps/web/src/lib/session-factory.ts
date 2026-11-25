import { getIronSession, IronSession } from "iron-session";
import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import { env } from "@/lib/env";
import { requestContext, type Principal, type RequestContext } from "@/lib/request-context";

interface MakeSessionOptions<T> {
  cookieName: string;
  /** Seconds. The seal expires with the cookie, not 14 days later (P5-1). */
  maxAge: number;
  /**
   * Runs on every request: checks the session against what is true now (the
   * account still exists, is active, and its session version matches) and
   * returns who is acting, or null to reject.
   */
  authorize: (session: IronSession<T>, req: NextRequest) => Promise<Principal | null>;
}

export function makeSession<T extends object>(options: MakeSessionOptions<T>) {
  const sessionOptions = {
    cookieName: options.cookieName,
    password: env.SESSION_SECRET,
    ttl: options.maxAge,
    cookieOptions: {
      secure: process.env.NODE_ENV === "production",
      httpOnly: true,
      sameSite: "lax" as const,
      maxAge: options.maxAge,
    },
  };

  async function getSession(): Promise<IronSession<T>> {
    const cookieStore = await cookies();
    return getIronSession<T>(cookieStore, sessionOptions);
  }

  async function requireSession(
    req: NextRequest,
  ): Promise<{ session: IronSession<T>; ctx: RequestContext } | NextResponse> {
    const session = await getSession();
    const principal = await options.authorize(session, req);
    if (!principal) {
      // The browser drops a cookie that no longer signs anyone in.
      session.destroy();
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    return { session, ctx: requestContext(req, principal) };
  }

  return { getSession, requireSession };
}
