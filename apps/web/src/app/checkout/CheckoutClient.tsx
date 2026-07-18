"use client";

import { useEffect, useState, useRef } from "react";
import { loadStripe } from "@stripe/stripe-js";
import { Elements } from "@stripe/react-stripe-js";
import { CheckoutForm } from "./CheckoutForm";
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";

const stripePromise = loadStripe(
  process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY!
);

function CheckoutInner({ operatorName }: { operatorName: string }) {
  const params = useSearchParams();
  const customerEmail = params.get("email") ?? "";
  const customerPhone = params.get("phone") ?? "";
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [meta, setMeta] = useState<{
    totalCents: number;
    confirmationCode: string;
    ticketCount: number;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const initialized = useRef(false);

  useEffect(() => {
    // Guard against React StrictMode double-invocation in dev
    if (initialized.current) return;
    initialized.current = true;

    const raw = params.get("cart");
    const name = params.get("name");
    const email = params.get("email");
    const phone = params.get("phone");

    if (!raw || !name || !email) {
      setError("Missing cart or customer info.");
      return;
    }

    let cart;
    try {
      cart = JSON.parse(decodeURIComponent(raw));
    } catch {
      setError("Invalid cart data.");
      return;
    }

    fetch("/api/bookings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ cart, customerName: name, customerEmail: email, customerPhone: phone }),
    })
      .then((r) => r.json())
      .then((data) => {
        if (data.error) { setError(data.error); return; }
        setClientSecret(data.clientSecret);
        setMeta({
          totalCents: data.totalCents,
          confirmationCode: data.confirmationCode,
          ticketCount: data.ticketCount,
        });
      })
      .catch(() => setError("Failed to create booking."));
  }, [params]);

  if (error) {
    return (
      <div className="min-h-screen bg-surface flex items-center justify-center p-8">
        <div className="bg-white rounded-card border border-card-border p-8 max-w-md w-full text-center">
          <div className="text-4xl mb-4">⚠️</div>
          <h1 className="font-grotesk text-xl font-semibold text-ink mb-2">Something went wrong</h1>
          <p className="text-muted text-sm">{error}</p>
          <a href="/" className="mt-6 inline-block text-teal text-sm font-medium underline">
            Back to calendar
          </a>
        </div>
      </div>
    );
  }

  if (!clientSecret || !meta) {
    return (
      <div className="min-h-screen bg-surface flex items-center justify-center">
        <div className="text-muted text-sm">Preparing your order…</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-surface font-jakarta">
      {/* App bar */}
      <header className="bg-white border-b border-hairline h-[66px] flex items-center px-5 md:px-8 gap-3">
        <a href="/" className="flex items-center gap-3">
          <div className="w-[34px] h-[34px] rounded-[10px] bg-teal flex items-center justify-center">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M2 20a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2"/><path d="M4 20l2-8h12l2 8"/><path d="M12 4v8"/><path d="M8 8h8"/>
            </svg>
          </div>
          <span className="font-grotesk text-[17px] font-semibold text-ink">{operatorName}</span>
        </a>
      </header>

      <div className="max-w-lg mx-auto px-5 py-8">
        {/* Order summary */}
        <div className="bg-white rounded-card border border-card-border p-5 mb-6">
          <div className="text-xs font-bold uppercase tracking-widest text-faint mb-3">Order Summary</div>
          <div className="flex justify-between items-center">
            <div className="text-sm text-muted">{meta.ticketCount} ticket{meta.ticketCount !== 1 ? "s" : ""}</div>
            <div className="font-grotesk text-[22px] font-bold text-ink">
              ${(meta.totalCents / 100).toFixed(2)}
            </div>
          </div>
        </div>

        {/* Payment form */}
        <div className="bg-white rounded-card border border-card-border p-5">
          <div className="text-xs font-bold uppercase tracking-widest text-faint mb-4">Payment</div>
          <Elements
            stripe={stripePromise}
            options={{
              clientSecret,
              appearance: {
                theme: "stripe",
                variables: {
                  colorPrimary: "#0E7C7B",
                  borderRadius: "12px",
                  fontFamily: "Plus Jakarta Sans, sans-serif",
                },
              },
            }}
          >
            <CheckoutForm
              totalCents={meta.totalCents}
              confirmationCode={meta.confirmationCode}
              customerEmail={customerEmail}
              customerPhone={customerPhone}
            />
          </Elements>
        </div>
      </div>
    </div>
  );
}

export function CheckoutClient({ operatorName }: { operatorName: string }) {
  return (
    <Suspense>
      <CheckoutInner operatorName={operatorName} />
    </Suspense>
  );
}
