import { NextRequest } from "next/server";
import { env } from "@/lib/env";
import { receiveStripeWebhook } from "@/lib/stripe-events/receive";

export const dynamic = "force-dynamic";

// The platform account's own events. Payments made before row 32 were
// destination charges on the platform, so their events arrive here.
export async function POST(req: NextRequest) {
  return receiveStripeWebhook(req, env.STRIPE_WEBHOOK_SECRET);
}
