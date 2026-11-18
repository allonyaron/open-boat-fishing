import { NextRequest, NextResponse } from "next/server";
import { env } from "@/lib/env";
import { stripe } from "@/lib/stripe";
import type Stripe from "stripe";
import { processEvent, recordEvent } from "@/lib/stripe-events/inbox";
import { dispatchStripeEvent } from "@/lib/stripe-events/dispatch";

export const dynamic = "force-dynamic";

// Stripe requires the raw body for signature verification — do NOT use req.json()
export async function POST(req: NextRequest) {
  const body = await req.text();
  const sig = req.headers.get("stripe-signature");

  if (!sig) {
    return NextResponse.json({ error: "Missing stripe-signature header" }, { status: 400 });
  }

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(body, sig, env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error("Stripe webhook signature verification failed:", err);
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }

  // Save the event before acting on it, then process it once (row 10). A
  // redelivery of a finished event changes nothing. If processing fails in a
  // way a retry can fix, answer 500 so Stripe redelivers; the expiry cron
  // also drains unfinished events.
  await recordEvent(event);
  const result = await processEvent(event.id, dispatchStripeEvent);
  if (result === "retry") {
    return NextResponse.json({ error: "Processing failed; will retry" }, { status: 500 });
  }
  if (result === "busy") {
    // Another delivery is processing it and may yet fail: ask Stripe to try
    // again later rather than acknowledging it.
    return NextResponse.json({ error: "Already being processed" }, { status: 409 });
  }

  return NextResponse.json({ ok: true });
}
