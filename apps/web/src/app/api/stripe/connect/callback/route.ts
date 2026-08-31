import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/session";
import { db } from "@/lib/db";
import { operators } from "@openboat/db";
import { eq } from "drizzle-orm";

export async function GET(req: NextRequest) {
  const auth = await requireAdmin(req);
  if (auth instanceof NextResponse) return auth;
  const { session } = auth;

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
  return NextResponse.redirect(dest);
}
