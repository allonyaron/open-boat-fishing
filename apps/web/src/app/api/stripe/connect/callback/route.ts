import { NextRequest, NextResponse } from "next/server";
import { createHmac, timingSafeEqual } from "crypto";
import { requireAdmin } from "@/lib/session";
import { env } from "@/lib/env";
import { db } from "@/lib/db";
import { operators } from "@openboat/db";
import { eq } from "drizzle-orm";

export async function GET(req: NextRequest) {
  const auth = await requireAdmin(req);
  if (auth instanceof NextResponse) return auth;
  const { session } = auth;

  // Verify the CSRF state before processing anything else.
  const state = req.nextUrl.searchParams.get("state");
  const nonce = req.cookies.get("stripe_connect_nonce")?.value;

  const errDest = new URL("/admin/settings", req.url);
  errDest.searchParams.set("stripe", "error");

  if (!state || !nonce) {
    console.error(`Stripe Connect callback: missing state or nonce for operator ${session.operatorId}`);
    return NextResponse.redirect(errDest);
  }

  const expected = createHmac("sha256", env.SESSION_SECRET).update(nonce).digest("hex");
  const eBuf = Buffer.from(expected);
  const sBuf = Buffer.from(state);
  if (eBuf.length !== sBuf.length || !timingSafeEqual(eBuf, sBuf)) {
    console.error(`Stripe Connect callback: invalid state for operator ${session.operatorId}`);
    return NextResponse.redirect(errDest);
  }

  const error = req.nextUrl.searchParams.get("error");
  const errorDesc = req.nextUrl.searchParams.get("error_description");

  if (error) {
    console.error(`Stripe Connect OAuth error for operator ${session.operatorId}: ${error} — ${errorDesc}`);
    const dest = new URL("/admin/settings", req.url);
    dest.searchParams.set("stripe", "cancelled");
    return NextResponse.redirect(dest);
  }

  const code = req.nextUrl.searchParams.get("code");
  if (!code) {
    const dest = new URL("/admin/settings", req.url);
    dest.searchParams.set("stripe", "error");
    return NextResponse.redirect(dest);
  }

  // Exchange authorization code for the connected account ID.
  // stripe.oauth was removed in SDK v22 — call the endpoint directly.
  let accountId: string;
  try {
    const tokenRes = await fetch("https://connect.stripe.com/oauth/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        client_secret: process.env.STRIPE_SECRET_KEY!,
      }),
    });

    const data = (await tokenRes.json()) as { stripe_user_id?: string; error?: string };

    if (!tokenRes.ok || !data.stripe_user_id) {
      console.error("Stripe OAuth token exchange failed:", data);
      const dest = new URL("/admin/settings", req.url);
      dest.searchParams.set("stripe", "error");
      return NextResponse.redirect(dest);
    }

    accountId = data.stripe_user_id;
  } catch (err) {
    console.error("Stripe OAuth token exchange threw:", err);
    const dest = new URL("/admin/settings", req.url);
    dest.searchParams.set("stripe", "error");
    return NextResponse.redirect(dest);
  }

  await db
    .update(operators)
    .set({
      stripeAccountId: accountId,
      stripeOnboardingComplete: true,
      updatedAt: new Date(),
    })
    .where(eq(operators.id, session.operatorId));

  console.log(`Stripe connected for operator ${session.operatorId}: ${accountId}`);

  const dest = new URL("/admin/settings", req.url);
  dest.searchParams.set("stripe", "connected");
  const successResponse = NextResponse.redirect(dest);
  successResponse.cookies.delete("stripe_connect_nonce");
  return successResponse;
}
