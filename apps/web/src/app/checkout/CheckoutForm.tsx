"use client";

import { useState } from "react";
import {
  PaymentElement,
  useStripe,
  useElements,
} from "@stripe/react-stripe-js";

export function CheckoutForm({
  totalCents,
  confirmationCode,
  customerEmail,
  customerPhone,
}: {
  totalCents: number;
  confirmationCode: string;
  customerEmail: string;
  customerPhone: string;
}) {
  const stripe = useStripe();
  const elements = useElements();
  const [error, setError] = useState<string | null>(null);
  const [processing, setProcessing] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!stripe || !elements) return;

    setProcessing(true);
    setError(null);

    const { error } = await stripe.confirmPayment({
      elements,
      confirmParams: {
        return_url: `${window.location.origin}/booking/delivery?code=${confirmationCode}&email=${encodeURIComponent(customerEmail)}&phone=${encodeURIComponent(customerPhone)}`,
      },
    });

    if (error) {
      setError(error.message ?? "Payment failed");
      setProcessing(false);
    }
    // On success Stripe redirects to return_url — no further handling needed here
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <PaymentElement
        options={{
          layout: "tabs",
        }}
      />

      {error && (
        <div className="text-red-600 text-sm bg-red-50 border border-red-200 rounded-lg px-4 py-3">
          {error}
        </div>
      )}

      <button
        type="submit"
        disabled={!stripe || processing}
        className="w-full bg-teal text-white font-grotesk font-semibold py-4 rounded-btn hover:bg-teal-hover transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
      >
        {processing ? "Processing…" : `Pay $${(totalCents / 100).toFixed(2)}`}
      </button>

      <p className="text-xs text-faint text-center">
        Purchasing tickets means you accept the{" "}
        <a href="/terms" className="underline text-teal">terms and conditions</a>.
        Payments processed securely by Stripe.
      </p>
    </form>
  );
}
