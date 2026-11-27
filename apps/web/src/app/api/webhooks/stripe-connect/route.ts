import { NextRequest, NextResponse } from "next/server";
import { env } from "@/lib/env";
import { receiveStripeWebhook } from "@/lib/stripe-events/receive";

export const dynamic = "force-dynamic";

// The connected accounts' events (a Connect endpoint in the Stripe Dashboard,
// with its own signing secret). Every payment is a direct charge on the
// operator's account since row 32, so its events arrive here, each carrying
// event.account.
export async function POST(req: NextRequest) {
  if (!env.STRIPE_CONNECT_WEBHOOK_SECRET) {
    console.error("STRIPE_CONNECT_WEBHOOK_SECRET is not set; connected-account events can't be verified");
    return NextResponse.json({ error: "Connect webhook not configured" }, { status: 503 });
  }
  return receiveStripeWebhook(req, env.STRIPE_CONNECT_WEBHOOK_SECRET);
}
