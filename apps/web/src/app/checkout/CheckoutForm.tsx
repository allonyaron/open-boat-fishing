"use client";

import { useState, useEffect, useCallback } from "react";
import { PaymentElement, useStripe, useElements } from "@stripe/react-stripe-js";
import posthog from "posthog-js";
import type { EnrichedCartItem } from "@/components/BookingCalendar";

function dollars(cents: number) {
  const n = cents / 100;
  return `$${Number.isInteger(n) ? n : n.toFixed(2)}`;
}

function fmtCountdown(msLeft: number): string {
  const totalSecs = Math.max(0, Math.ceil(msLeft / 1000));
  const m = Math.floor(totalSecs / 60);
  const s = totalSecs % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function CheckoutForm({
  totalCents,
  confirmationCode,
  customerEmail,
  customerPhone,
  bookingId,
  holdExpiresAt,
  cartItems,
}: {
  totalCents: number;
  confirmationCode: string;
  customerEmail: string;
  customerPhone: string;
  bookingId: string;
  holdExpiresAt: string;
  cartItems: EnrichedCartItem[];
}) {
  const stripe = useStripe();
  const elements = useElements();
  const [error, setError] = useState<string | null>(null);
  const [processing, setProcessing] = useState(false);
  const [expired, setExpired] = useState(false);
  const [msLeft, setMsLeft] = useState<number>(() => new Date(holdExpiresAt).getTime() - Date.now());

  // Countdown ticker — only renders when under 2 minutes
  useEffect(() => {
    const tick = () => {
      const remaining = new Date(holdExpiresAt).getTime() - Date.now();
      setMsLeft(remaining);
      if (remaining <= 0) setExpired(true);
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [holdExpiresAt]);

  const extendHold = useCallback(async () => {
    try {
      await fetch(`/api/bookings/${bookingId}/extend-hold`, { method: "PATCH" });
    } catch {
      // Non-fatal — Stripe will still attempt payment; worst case is expiry fires
    }
  }, [bookingId]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!stripe || !elements || expired) return;

    setProcessing(true);
    setError(null);

    // Extend the hold before handing off to Stripe so 3DS / wallet flows
    // don't race against the expiry cron.
    await extendHold();
    posthog.capture("payment_attempt", { total_cents: totalCents });

    const { error } = await stripe.confirmPayment({
      elements,
      confirmParams: {
        return_url: `${window.location.origin}/booking/delivery?code=${confirmationCode}&email=${encodeURIComponent(customerEmail)}&phone=${encodeURIComponent(customerPhone)}`,
      },
    });

    if (error) {
      const isExpired =
        error.code === "payment_intent_unexpected_state" ||
        error.type === "invalid_request_error";

      if (isExpired) {
        setExpired(true);
      } else {
        posthog.capture("payment_failure", {
          total_cents: totalCents,
          error_code: error.code,
          error_type: error.type,
        });
        setError(error.message ?? "Payment failed");
      }
      setProcessing(false);
    }
    // On success Stripe redirects to return_url — no further handling needed here
  }

  // ── Expired state ────────────────────────────────────────────────────────────
  if (expired) {
    return (
      <div className="space-y-5">
        <div className="bg-amber-50 border border-amber-200 rounded-[12px] px-4 py-4">
          <div className="font-grotesk text-[15px] font-semibold text-amber-900 mb-1">
            Your reservation timed out
          </div>
          <div className="text-[13px] text-amber-800">
            Your seats have been released. Check if they're still available below.
          </div>
        </div>

        <div className="space-y-2">
          {cartItems.map((item) => (
            <div key={item.tripId} className="text-[13px] text-muted flex gap-2 items-start">
              <div className="w-2 h-2 rounded-full mt-1 flex-shrink-0" style={{ backgroundColor: item.vesselColor }} />
              <div>
                <span className="font-semibold text-ink">{item.productName}</span>
                {" · "}{item.vesselName}
                {" · "}{new Date(item.departureDate + "T12:00:00Z").toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                {" · "}{item.tickets.map((t) => `${t.quantity} ${t.ticketType}`).join(", ")}
              </div>
            </div>
          ))}
        </div>

        <a
          href="/"
          className="block w-full py-4 rounded-btn bg-teal text-white font-grotesk text-[15px] font-semibold text-center hover:bg-teal-hover transition-colors"
        >
          Check availability →
        </a>
      </div>
    );
  }

  // ── Normal payment form ───────────────────────────────────────────────────────
  const showCountdown = msLeft > 0 && msLeft < 2 * 60 * 1000;

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {showCountdown && (
        <div className="flex items-center gap-2 bg-amber-50 border border-amber-200 rounded-[12px] px-4 py-3">
          <svg className="text-amber-600 flex-shrink-0" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
          </svg>
          <span className="text-[13px] text-amber-900 font-medium">
            Reservation held for <span className="font-grotesk font-bold">{fmtCountdown(msLeft)}</span>
          </span>
        </div>
      )}

      <PaymentElement options={{ layout: "tabs" }} />

      {error && (
        <div className="text-red-600 text-sm bg-red-50 border border-red-200 rounded-lg px-4 py-3">
          {error}
        </div>
      )}

      <p className="text-xs text-faint text-center">
        By completing this purchase you accept the{" "}
        <a href="/terms" className="underline text-teal">terms and conditions</a>.
        Payments processed securely by Stripe.
      </p>

      <button
        type="submit"
        disabled={!stripe || processing || expired}
        className="w-full bg-teal text-white font-grotesk font-semibold py-4 rounded-btn hover:bg-teal-hover transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
      >
        {processing ? "Processing…" : `Pay ${dollars(totalCents)}`}
      </button>
    </form>
  );
}
