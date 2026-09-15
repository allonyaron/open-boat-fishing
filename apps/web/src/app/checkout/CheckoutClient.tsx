"use client";

import { useState, useEffect, Suspense } from "react";
import { loadStripe } from "@stripe/stripe-js";
import { Elements } from "@stripe/react-stripe-js";
import { CheckoutForm } from "./CheckoutForm";
import posthog from "posthog-js";
import type { EnrichedCartItem } from "@/components/BookingCalendar";
import { BookingNav } from "@/components/BookingCalendar";

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
  const [items, setItems] = useState<EnrichedCartItem[]>([]);
  const [initialized, setInitialized] = useState(false);

  useEffect(() => {
    try {
      const raw = localStorage.getItem("openboat_cart");
      if (raw) {
        setItems(JSON.parse(raw));
      } else {
        // No cart — if there's a pending payment in progress, redirect to confirmation
        const pending = localStorage.getItem("openboat_pending_payment");
        if (pending) {
          const { confirmationCode } = JSON.parse(pending);
          window.location.href = `/booking/confirmation?code=${confirmationCode}`;
          return; // skip setInitialized — we're redirecting
        }
      }
    } catch { /* ignore */ }
    setInitialized(true); // safe to render now
    posthog.capture("checkout_view");
  }, []);

  if (!initialized) {
    return <Shell operatorName={operatorName} phone={phone} dockAddress={dockAddress}>{null}</Shell>;
  }

  if (items.length === 0) {
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

  const totalCents = items.reduce(
    (sum, item) => sum + item.tickets.reduce((s, t) => s + t.priceCents * t.quantity, 0),
    0,
  );

  return (
    <Shell operatorName={operatorName} phone={phone} dockAddress={dockAddress}>
      <Elements
        stripe={stripePromise}
        options={{
          mode: "payment",
          amount: totalCents,
          currency: "usd",
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
        }}
      >
        <CheckoutForm items={items} />
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
