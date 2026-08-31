import { NextRequest, NextResponse } from "next/server";
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

  const redirectUri = new URL("/api/stripe/connect/callback", req.url).toString();

  const params = new URLSearchParams({
    client_id: env.STRIPE_CLIENT_ID,
    response_type: "code",
    scope: "read_write",
    redirect_uri: redirectUri,
  });

  return NextResponse.redirect(
    `https://connect.stripe.com/oauth/authorize?${params.toString()}`,
  );
}
