import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { stripe } from "@/lib/stripe";
import { handlePaymentIntentSucceeded } from "@/lib/webhooks/payment-intent-succeeded";
import { handlePaymentIntentCanceled } from "@/lib/webhooks/payment-intent-canceled";
import { handleChargeRefunded } from "@/lib/webhooks/charge-refunded";
import { handleChargeDisputeCreated } from "@/lib/webhooks/charge-dispute-created";
import { operators } from "@openboat/db";
import { eq } from "drizzle-orm";
import type Stripe from "stripe";

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

  // Centralized mode: platform-level Connect webhooks carry event.account
  // (the connected account that generated the event). Validate it against a
  // known operator before processing — rejects events from unknown accounts.
  // Single-deploy webhooks are registered on the connected account directly
  // and do not carry event.account; skip this check in that case.
  if (event.account) {
    const [operator] = await db
      .select({ id: operators.id })
      .from(operators)
      .where(eq(operators.stripeAccountId, event.account));
    if (!operator) {
      console.error(`Webhook from unknown connected account: ${event.account}`);
      return NextResponse.json({ error: "Unknown account" }, { status: 400 });
    }
  }

  if (event.type === "payment_intent.succeeded") {
    await handlePaymentIntentSucceeded(event.data.object as Stripe.PaymentIntent);
  } else if (event.type === "payment_intent.canceled") {
    await handlePaymentIntentCanceled(event.data.object as Stripe.PaymentIntent);
  } else if (event.type === "charge.refunded") {
    await handleChargeRefunded(event.data.object as Stripe.Charge);
  } else if (event.type === "charge.dispute.created") {
    await handleChargeDisputeCreated(event.data.object as Stripe.Dispute);
  }

  return NextResponse.json({ ok: true });
}
