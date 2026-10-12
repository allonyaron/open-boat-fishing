"use client";

import { useEffect, useMemo, useRef, useState, Suspense } from "react";
import { loadStripe, type StripeElementsOptionsMode } from "@stripe/stripe-js";
import { Elements } from "@stripe/react-stripe-js";
import { CheckoutForm } from "./CheckoutForm";
import posthog from "posthog-js";
import { BookingNav } from "@/components/BookingCalendar";
import { ALLOWED_PAYMENT_METHOD_TYPES } from "@/lib/payment-methods";
import { clearHold, loadHold, releaseHold } from "@/lib/checkout/stored-hold";
import { useCartStore } from "@/lib/cart/store";
import { useQuote } from "@/lib/cart/quote";

const stripePromise = loadStripe(process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY!);

function Shell({
  operatorName,
  phone,
  dockAddress,
  children,
}: {
  operatorName: string;
  phone: string | null;
  dockAddress: string | null;
  children: React.ReactNode;
}) {
  return (
    <div
      className="font-archivo"
      style={{ maxWidth: 1440, margin: "0 auto", borderLeft: "2px solid #cdd6da", borderRight: "2px solid #cdd6da", minHeight: "100vh", background: "#eef1f0" }}
    >
      <BookingNav operatorName={operatorName} dockAddress={dockAddress} phone={phone} step={2} />
      {children}
    </div>
  );
}

function CheckoutInner({
  operatorName,
  phone,
  dockAddress,
}: {
  operatorName: string;
  phone: string | null;
  dockAddress: string | null;
}) {
  // The cart stays until the payment succeeds (the confirmed-booking view
  // clears it), so a reload or a retry still has it.
  const { lines, ready } = useCartStore();
  const quote = useQuote(lines);

  useEffect(() => {
    posthog.capture("checkout_view");
  }, []);

  // Nothing to check out, so a booking saved by this tab is abandoned. (With
  // a cart, CheckoutForm resumes or releases it.)
  const checkedEmpty = useRef(false);
  useEffect(() => {
    if (!ready || checkedEmpty.current) return;
    checkedEmpty.current = true;
    if (lines.length > 0) return;
    const hold = loadHold();
    if (hold) {
      void releaseHold(hold).then((result) => {
        if (result !== "failed") clearHold();
      });
    }
  }, [ready, lines.length]);

  // Elements needs an amount when it mounts, so it waits for the first quote.
  // After that CheckoutForm alone keeps the amount in step with what the
  // customer will be charged (elements.update), so the options never change.
  const settled = ready && (lines.length === 0 || quote.status === "ready" || quote.status === "error");
  const [mountAmount, setMountAmount] = useState<number | null>(null);
  useEffect(() => {
    if (!settled || mountAmount !== null || lines.length === 0) return;
    // A cart the server can't price (its error is shown) still mounts the form,
    // so a held booking can be resumed or released. Pay stays disabled until
    // there's a real amount, so this placeholder is never charged.
    setMountAmount(quote.status === "ready" ? quote.quote.totalCents : 100);
  }, [settled, mountAmount, lines.length, quote]);
  const elementsOptions = useMemo(
    () => (mountAmount === null ? null : elementsOptionsFor(mountAmount)),
    [mountAmount],
  );
  // Once mounted, the form stays mounted: a later re-quote (loading again)
  // mustn't wipe the customer's details and card.
  const initialized = elementsOptions !== null || (ready && lines.length === 0);

  if (!initialized) {
    return <Shell operatorName={operatorName} phone={phone} dockAddress={dockAddress}>{null}</Shell>;
  }

  if (lines.length === 0 || !elementsOptions) {
    return (
      <Shell operatorName={operatorName} phone={phone} dockAddress={dockAddress}>
        <div style={{ maxWidth: 760, margin: "0 auto", padding: "60px 24px", textAlign: "center" }}>
          <div style={{ fontFamily: "var(--font-ibm-plex-mono)", fontSize: 13, letterSpacing: ".12em", color: "#41565f", marginBottom: 12 }}>
            YOUR CART IS EMPTY
          </div>
          <a
            href="/book"
            style={{ fontFamily: "var(--font-ibm-plex-mono)", fontSize: 12, letterSpacing: ".1em", color: "#8c3b12", textDecoration: "underline" }}
          >
            ← PICK A TRIP
          </a>
        </div>
      </Shell>
    );
  }

  return (
    <Shell operatorName={operatorName} phone={phone} dockAddress={dockAddress}>
      <Elements stripe={stripePromise} options={elementsOptions}>
        <CheckoutForm lines={lines} quote={quote} />
      </Elements>

      {/* Checkout footer — trust/contact line only, not the full site footer */}
      <div
        className="hull bg-hull font-plex-mono text-[12px] tracking-[.06em]"
        style={{ padding: "20px 24px", color: "#c9d6dd", display: "flex", flexWrap: "wrap", gap: "10px 26px", justifyContent: "space-between" }}
      >
        <span>{dockAddress ?? ""}</span>
        {phone && <span>QUESTIONS? {phone}</span>}
      </div>
    </Shell>
  );
}

export function CheckoutClient({
  operatorName,
  phone,
  dockAddress,
}: {
  operatorName: string;
  phone: string | null;
  dockAddress: string | null;
}) {
  return (
    <Suspense>
      <CheckoutInner operatorName={operatorName} phone={phone} dockAddress={dockAddress} />
    </Suspense>
  );
}

function elementsOptionsFor(amount: number): StripeElementsOptionsMode {
  return {
    mode: "payment",
    amount,
    currency: "usd",
    // Must match the PaymentIntent's payment_method_types (P2-5).
    paymentMethodTypes: [...ALLOWED_PAYMENT_METHOD_TYPES],
    appearance: {
      theme: "flat",
      variables: {
        colorPrimary: "#c94510",
        colorBackground: "#ffffff",
        colorText: "#16354a",
        colorDanger: "#8c3b12",
        fontFamily: "Archivo, Helvetica, sans-serif",
        borderRadius: "0px",
        fontSizeBase: "17px",
      },
      rules: {
        ".Input": {
          border: "1px solid #9aa8ae",
          padding: "16px",
          fontSize: "17px",
        },
        ".Input:focus": {
          border: "1px solid #c94510",
          outline: "2px solid #c94510",
          outlineOffset: "2px",
        },
        ".Label": {
          fontFamily: "Archivo, Helvetica, sans-serif",
          fontWeight: "600",
          fontSize: "14px",
          color: "#16354a",
          marginBottom: "6px",
        },
        ".Error": {
          color: "#8c3b12",
          fontSize: "14px",
        },
      },
    },
  };
}
