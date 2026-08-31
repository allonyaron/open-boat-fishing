import { NextRequest, NextResponse } from "next/server";
import { createHmac, randomBytes } from "crypto";
import { requireAdmin } from "@/lib/session";
import { env } from "@/lib/env";

export async function GET(req: NextRequest) {
  const auth = await requireAdmin(req);
  if (auth instanceof NextResponse) return auth;

  if (!env.STRIPE_CLIENT_ID) {
    return NextResponse.json(
      { error: "STRIPE_CLIENT_ID is not configured on this deployment" },
      { status: 500 },
    );
  }

  // CSRF protection: generate a one-time nonce, sign it with SESSION_SECRET,
  // and pass the signature as `state`. The nonce is stored in a short-lived
  // httpOnly cookie. The callback verifies the signature matches the cookie.
  const nonce = randomBytes(16).toString("hex");
  const state = createHmac("sha256", env.SESSION_SECRET).update(nonce).digest("hex");

  const redirectUri = new URL("/api/stripe/connect/callback", req.url).toString();

  const params = new URLSearchParams({
    client_id: env.STRIPE_CLIENT_ID,
    response_type: "code",
    scope: "read_write",
    redirect_uri: redirectUri,
    state,
  });

  const response = NextResponse.redirect(
    `https://connect.stripe.com/oauth/authorize?${params.toString()}`,
  );

  response.cookies.set("stripe_connect_nonce", nonce, {
    httpOnly: true,
    sameSite: "lax",
    maxAge: 600, // 10 minutes — enough to complete the OAuth flow
    path: "/",
  });

  return response;
}
