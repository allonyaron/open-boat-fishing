import { getIronSession, IronSession } from "iron-session";
import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import { env } from "@/lib/env";

interface MakeSessionOptions<T> {
  cookieName: string;
  maxAge: number;
  isAuthorized: (data: T) => boolean;
}

export function makeSession<T extends object>(options: MakeSessionOptions<T>) {
  const sessionOptions = {
    cookieName: options.cookieName,
    password: env.SESSION_SECRET,
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
    _req: NextRequest,
  ): Promise<{ session: IronSession<T> } | NextResponse> {
    const session = await getSession();
    if (!options.isAuthorized(session)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    return { session };
  }

  return { getSession, requireSession };
}
