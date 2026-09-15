"use client";

import { useState, useEffect } from "react";
import { PaymentElement, useStripe, useElements } from "@stripe/react-stripe-js";
import posthog from "posthog-js";
import type { EnrichedCartItem } from "@/components/BookingCalendar";
import { fmtTimeET } from "@/lib/format";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtDollars(cents: number) {
  return `$${Math.round(cents / 100)}`;
}

function fmtDate(d: string) {
  return new Date(d + "T12:00:00Z").toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  });
}

function fmtPhoneDisplay(value: string) {
  const digits = value.replace(/\D/g, "").slice(0, 10);
  if (digits.length <= 3) return digits;
  if (digits.length <= 6) return `(${digits.slice(0, 3)}) ${digits.slice(3)}`;
  return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
}

function validateEmail(v: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim());
}
function validatePhone(v: string) {
  return v.replace(/\D/g, "").length === 10;
}

function fmtCountdown(msLeft: number): string {
  const totalSecs = Math.max(0, Math.ceil(msLeft / 1000));
  const m = Math.floor(totalSecs / 60);
  const s = totalSecs % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

// ─── Input field — error slot always reserves space, no layout shift ──────────

function Field({
  id,
  label,
  type = "text",
  value,
  onChange,
  onBlur,
  error,
  placeholder,
  required,
  autoComplete,
  inputMode,
}: {
  id: string;
  label: string;
  type?: string;
  value: string;
  onChange: (v: string) => void;
  onBlur: () => void;
  error: string | null;
  placeholder?: string;
  required?: boolean;
  autoComplete?: string;
  inputMode?: React.HTMLAttributes<HTMLInputElement>["inputMode"];
}) {
  return (
    <label htmlFor={id} style={{ display: "block" }}>
      <span style={{ display: "block", fontSize: 14, fontWeight: 600, marginBottom: 6, fontFamily: "var(--font-archivo)" }}>
        {label}
      </span>
      <input
        id={id}
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onBlur={onBlur}
        placeholder={placeholder}
        required={required}
        autoComplete={autoComplete}
        inputMode={inputMode}
        style={{
          width: "100%",
          boxSizing: "border-box",
          border: `1px solid ${error ? "#c94510" : "#9aa8ae"}`,
          background: "#fff",
          padding: 16,
          fontFamily: "var(--font-archivo)",
          fontSize: 17,
          color: "#16354a",
          borderRadius: 0,
          outline: "none",
        }}
        onFocus={(e) => { e.currentTarget.style.outline = "2px solid #c94510"; e.currentTarget.style.outlineOffset = "2px"; }}
        onBlurCapture={(e) => { e.currentTarget.style.outline = "none"; }}
      />
      <div style={{ minHeight: 20, paddingTop: 4, fontSize: 13, fontWeight: 600, color: "#b1440f", fontFamily: "var(--font-archivo)" }}>
        {error}
      </div>
    </label>
  );
}

// ─── Order summary card ───────────────────────────────────────────────────────

function OrderCard({ items, totalCents }: { items: EnrichedCartItem[]; totalCents: number }) {
  return (
    <div style={{ background: "#fff", border: "1px solid #cdd6da", marginTop: 14 }}>
      {items.map((item) => {
        const subtotal = item.tickets.reduce((s, t) => s + t.quantity * t.priceCents, 0);
        const faresLabel = item.tickets
          .map((t) => `${t.quantity} ${t.ticketType} × ${fmtDollars(t.priceCents)}`)
          .join(" · ");
        return (
          <div
            key={item.tripId}
            style={{ padding: "18px 20px", borderBottom: "1px solid #e3e9eb", display: "flex", justifyContent: "space-between", gap: 16 }}
          >
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 18, fontWeight: 700, fontFamily: "var(--font-archivo)" }}>
                {item.productName}
              </div>
              <div style={{ fontFamily: "var(--font-ibm-plex-mono)", fontSize: 13, color: "#41565f", marginTop: 4 }}>
                {fmtDate(item.departureDate)} · {fmtTimeET(item.startTime)}
              </div>
              <div style={{ fontFamily: "var(--font-ibm-plex-mono)", fontSize: 13, color: "#41565f", marginTop: 2 }}>
                {faresLabel}
              </div>
            </div>
            <div style={{ fontFamily: "var(--font-ibm-plex-mono)", fontSize: 18, fontWeight: 600, whiteSpace: "nowrap" }}>
              {fmtDollars(subtotal)}
            </div>
          </div>
        );
      })}
      {/* Hull total footer */}
      <div
        style={{ padding: "18px 20px", display: "flex", justifyContent: "space-between", alignItems: "baseline", background: "#16354a", color: "#fff" }}
      >
        <span style={{ fontFamily: "var(--font-ibm-plex-mono)", fontSize: 12, letterSpacing: ".16em", color: "#c9d6dd" }}>
          TOTAL DUE TODAY
        </span>
        <span style={{ fontFamily: "var(--font-ibm-plex-mono)", fontSize: 30, fontWeight: 700 }}>
          {fmtDollars(totalCents)}
        </span>
      </div>
    </div>
  );
}

// ─── Seat hold countdown banner ───────────────────────────────────────────────

function HoldBanner({ holdExpiresAt }: { holdExpiresAt: string }) {
  const [msLeft, setMsLeft] = useState(() => new Date(holdExpiresAt).getTime() - Date.now());

  useEffect(() => {
    const tick = () => setMsLeft(new Date(holdExpiresAt).getTime() - Date.now());
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [holdExpiresAt]);

  const expired = msLeft <= 0;
  const low = msLeft <= 120_000;
  const color = expired || low ? "#8c3b12" : "#41565f";

  return (
    <div
      style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginTop: 18, border: "1px solid #cdd6da", background: "#fff", padding: "12px 16px" }}
    >
      <span style={{ fontFamily: "var(--font-ibm-plex-mono)", fontSize: 12, letterSpacing: ".12em", color: "#41565f" }}>
        SEATS HELD FOR YOU
      </span>
      <span style={{ fontFamily: "var(--font-ibm-plex-mono)", fontSize: 17, fontWeight: 600, color }}>
        {expired ? "HOLD EXPIRED — SEATS RELEASED" : fmtCountdown(msLeft)}
      </span>
    </div>
  );
}

// ─── Checkout form — one page, one button, one commitment ─────────────────────

export function CheckoutForm({ items }: { items: EnrichedCartItem[] }) {
  const stripe = useStripe();
  const elements = useElements();

  const [name, setName] = useState("");
  const [mobile, setMobile] = useState("");
  const [email, setEmail] = useState("");
  const [touched, setTouched] = useState({ name: false, mobile: false, email: false });
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [meta, setMeta] = useState<{ holdExpiresAt: string } | null>(null);

  const nameError = touched.name && !name.trim() ? "Name is required" : null;
  const mobileError = touched.mobile && mobile && !validatePhone(mobile) ? "Enter a 10-digit US number" : null;
  const emailError = touched.email && !validateEmail(email) ? "Enter a valid email address" : null;

  const totalCents = items.reduce(
    (sum, item) => sum + item.tickets.reduce((s, t) => s + t.priceCents * t.quantity, 0),
    0,
  );

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setTouched({ name: true, mobile: true, email: true });
    if (!name.trim() || !validateEmail(email) || (mobile && !validatePhone(mobile))) return;
    if (!stripe || !elements || submitting) return;

    setSubmitting(true);
    setSubmitError(null);

    const { error: elementsError } = await elements.submit();
    if (elementsError) {
      setSubmitError(elementsError.message ?? "Check the payment details above.");
      setSubmitting(false);
      return;
    }

    const cart = items.map((item) => ({
      tripId: item.tripId,
      tickets: item.tickets.map((t) => ({ ticketType: t.ticketType, quantity: t.quantity })),
    }));

    posthog.capture("payment_attempt", { total_cents: totalCents });

    let data: {
      error?: string;
      clientSecret?: string;
      confirmationCode?: string;
      bookingId?: string;
      holdExpiresAt?: string;
    };
    try {
      const res = await fetch("/api/bookings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          cart,
          customerName: name.trim(),
          customerEmail: email.trim(),
          customerPhone: mobile.trim() || null,
          notes: null,
        }),
      });
      data = await res.json();
    } catch {
      setSubmitError("Something went wrong. Please try again.");
      setSubmitting(false);
      return;
    }

    if (data.error || !data.clientSecret || !data.confirmationCode || !data.bookingId) {
      setSubmitError(data.error ?? "Something went wrong. Please try again.");
      setSubmitting(false);
      return;
    }

    setMeta({ holdExpiresAt: data.holdExpiresAt! });
    localStorage.setItem("openboat_pending_payment", JSON.stringify({ confirmationCode: data.confirmationCode }));
    localStorage.removeItem("openboat_cart");

    // Extend the hold once more before handing off to Stripe so a 3DS challenge
    // or wallet sheet doesn't race against the expiry cron.
    fetch(`/api/bookings/${data.bookingId}/extend-hold`, { method: "PATCH" }).catch(() => {});

    const { error: payError } = await stripe.confirmPayment({
      elements,
      clientSecret: data.clientSecret,
      confirmParams: {
        return_url: `${window.location.origin}/booking/delivery?code=${data.confirmationCode}&email=${encodeURIComponent(email.trim())}&phone=${encodeURIComponent(mobile.trim())}`,
      },
    });

    if (payError) {
      posthog.capture("payment_failure", {
        total_cents: totalCents,
        error_code: payError.code,
        error_type: payError.type,
        error_message: payError.message,
      });
      setSubmitError(
        payError.code === "payment_intent_unexpected_state"
          ? "Your reservation timed out and seats were released. Refresh to check availability."
          : payError.message ?? "Payment failed. Please try again.",
      );
      setSubmitting(false);
    }
    // On success Stripe redirects to return_url — no further handling needed here
  }

  return (
    <form onSubmit={handleSubmit} style={{ maxWidth: 760, margin: "0 auto", padding: "16px 16px 60px" }} className="lg:px-[34px] lg:pt-[34px]">
      <a
        href="/book"
        className="hidden lg:inline"
        style={{ fontFamily: "var(--font-ibm-plex-mono)", fontSize: 12, letterSpacing: ".1em", color: "#8c3b12", textDecoration: "underline" }}
      >
        ← BACK TO TRIPS · ADD ANOTHER
      </a>

      <h1
        style={{ margin: "16px 0 0", fontFamily: "var(--font-archivo)", fontSize: "clamp(30px, 4vw, 40px)", fontWeight: 700, textTransform: "uppercase", letterSpacing: "-.02em", lineHeight: 1, color: "#16354a" }}
      >
        ONE PAGE.<br />THEN YOU&apos;RE FISHING.
      </h1>

      {meta && <HoldBanner holdExpiresAt={meta.holdExpiresAt} />}

      <OrderCard items={items} totalCents={totalCents} />

      <div style={{ fontFamily: "var(--font-ibm-plex-mono)", fontSize: 12, letterSpacing: ".16em", color: "#41565f", margin: "34px 0 12px" }}>
        WHO&apos;S FISHING
      </div>

      <div className="booking-co-grid">
        <Field
          id="checkout-name"
          label="Name on the manifest"
          value={name}
          onChange={setName}
          onBlur={() => setTouched((t) => ({ ...t, name: true }))}
          error={nameError}
          placeholder="Sal Marino"
          required
          autoComplete="name"
        />
        <Field
          id="checkout-mobile"
          label="Mobile — we text if weather cancels"
          type="tel"
          value={mobile}
          onChange={(v) => setMobile(fmtPhoneDisplay(v))}
          onBlur={() => setTouched((t) => ({ ...t, mobile: true }))}
          error={mobileError}
          placeholder="(631) 555-0100"
          autoComplete="tel"
          inputMode="numeric"
        />
      </div>

      <div style={{ marginTop: 4 }}>
        <Field
          id="checkout-email"
          label="Email — receipt and boarding pass"
          type="email"
          value={email}
          onChange={setEmail}
          onBlur={() => setTouched((t) => ({ ...t, email: true }))}
          error={emailError}
          placeholder="you@example.com"
          required
          autoComplete="email"
        />
      </div>

      <div style={{ fontFamily: "var(--font-ibm-plex-mono)", fontSize: 12, letterSpacing: ".16em", color: "#41565f", margin: "26px 0 12px" }}>
        PAYMENT
      </div>
      <div style={{ background: "#fff", border: "1px solid #cdd6da", padding: 20 }}>
        <PaymentElement options={{ layout: "tabs" }} />
      </div>

      <div style={{ minHeight: 52, marginTop: 16 }}>
        {submitError && (
          <div
            style={{ border: "1px solid #c94510", background: "#fdeee8", color: "#8c3b12", fontSize: 15, fontWeight: 600, padding: "14px 16px", fontFamily: "var(--font-archivo)" }}
          >
            {submitError}
          </div>
        )}
      </div>

      <button
        type="submit"
        disabled={!stripe || !elements || submitting}
        style={{
          width: "100%",
          minHeight: 72,
          padding: "20px 16px",
          background: submitting ? "#b1440f" : "#c94510",
          color: "#fff",
          border: "none",
          fontFamily: "var(--font-archivo)",
          fontSize: 19,
          fontWeight: 700,
          letterSpacing: ".06em",
          textTransform: "uppercase",
          cursor: submitting ? "not-allowed" : "pointer",
        }}
      >
        {submitting ? "PROCESSING…" : `PAY ${fmtDollars(totalCents)} · BOOK MY SEATS`}
      </button>

      <div
        style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 14, fontFamily: "var(--font-ibm-plex-mono)", fontSize: 11, letterSpacing: ".06em", color: "#41565f" }}
      >
        <span>FREE CANCELLATION TO 24H BEFORE SAILING</span>
        <span>WEATHER CANCELLATION = AUTOMATIC REFUND</span>
        <span>SECURED BY STRIPE</span>
      </div>
    </form>
  );
}
