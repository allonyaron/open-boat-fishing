"use client";

import { useState, useEffect, useRef, Suspense } from "react";
import { loadStripe } from "@stripe/stripe-js";
import { Elements } from "@stripe/react-stripe-js";
import { CheckoutForm } from "./CheckoutForm";
import posthog from "posthog-js";
import type { EnrichedCartItem } from "@/components/BookingCalendar";
import { BookingNav } from "@/components/BookingCalendar";
import { fmtTimeET } from "@/lib/format";

const stripePromise = loadStripe(process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY!);

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

// ─── Input field with blur validation ────────────────────────────────────────

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
  disabled,
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
  disabled?: boolean;
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
        disabled={disabled}
        autoComplete={autoComplete}
        inputMode={inputMode}
        style={{
          width: "100%",
          boxSizing: "border-box",
          border: `1px solid ${error ? "#8c3b12" : "#9aa8ae"}`,
          background: "#fff",
          padding: 16,
          fontFamily: "var(--font-archivo)",
          fontSize: 17,
          color: "#0d1c26",
          borderRadius: 0,
          outline: "none",
          opacity: disabled ? 0.6 : 1,
        }}
        onFocus={(e) => { e.currentTarget.style.outline = "2px solid #d1541f"; e.currentTarget.style.outlineOffset = "2px"; }}
        onBlurCapture={(e) => { e.currentTarget.style.outline = "none"; }}
      />
      {error && (
        <span style={{ display: "block", fontSize: 14, color: "#8c3b12", marginTop: 4, fontFamily: "var(--font-archivo)" }}>
          {error}
        </span>
      )}
    </label>
  );
}

// ─── Order summary card ───────────────────────────────────────────────────────

function OrderCard({ items, totalCents }: { items: EnrichedCartItem[]; totalCents: number }) {
  return (
    <div style={{ background: "#fff", border: "1px solid #cdd6da", marginTop: 24 }}>
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
        style={{ padding: "18px 20px", display: "flex", justifyContent: "space-between", alignItems: "baseline", background: "#0d1c26", color: "#fff" }}
      >
        <span style={{ fontFamily: "var(--font-ibm-plex-mono)", fontSize: 12, letterSpacing: ".16em", color: "#8fa3ad" }}>
          TOTAL DUE TODAY
        </span>
        <span style={{ fontFamily: "var(--font-ibm-plex-mono)", fontSize: 30, fontWeight: 700 }}>
          {fmtDollars(totalCents)}
        </span>
      </div>
    </div>
  );
}

// ─── Checkout inner ───────────────────────────────────────────────────────────

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
  const [phase, setPhase] = useState<"contact" | "payment">("contact");
  const [initialized, setInitialized] = useState(false);

  // contact fields
  const [name, setName] = useState("");
  const [mobile, setMobile] = useState("");
  const [email, setEmail] = useState("");

  // touched state for blur validation
  const [touched, setTouched] = useState({ name: false, mobile: false, email: false });

  // payment phase
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [meta, setMeta] = useState<{
    totalCents: number;
    confirmationCode: string;
    bookingId: string;
    holdExpiresAt: string;
    ticketCount: number;
  } | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const paymentRef = useRef<HTMLDivElement>(null);

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

  // inline validation
  const nameError = touched.name && !name.trim() ? "Name is required" : null;
  const mobileError = touched.mobile && mobile && !validatePhone(mobile)
    ? "Enter a 10-digit US number"
    : null;
  const emailError = touched.email && !validateEmail(email)
    ? "Enter a valid email address"
    : null;

  const totalCents = items.reduce(
    (sum, item) => sum + item.tickets.reduce((s, t) => s + t.priceCents * t.quantity, 0),
    0,
  );
  const totalTickets = items.reduce(
    (sum, item) => sum + item.tickets.reduce((s, t) => s + t.quantity, 0),
    0,
  );

  async function handleContactSubmit() {
    setTouched({ name: true, mobile: true, email: true });
    if (!name.trim() || !validateEmail(email) || (mobile && !validatePhone(mobile))) return;

    setSubmitting(true);
    setSubmitError(null);

    const cart = items.map((item) => ({
      tripId: item.tripId,
      tickets: item.tickets.map((t) => ({ ticketType: t.ticketType, quantity: t.quantity })),
    }));

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
      const data = await res.json();
      if (data.error) {
        setSubmitError(data.error);
        setSubmitting(false);
        return;
      }

      setClientSecret(data.clientSecret);
      setMeta({
        totalCents: data.totalCents,
        confirmationCode: data.confirmationCode,
        bookingId: data.bookingId,
        holdExpiresAt: data.holdExpiresAt,
        ticketCount: data.ticketCount,
      });
      localStorage.setItem("openboat_pending_payment", JSON.stringify({ confirmationCode: data.confirmationCode }));
      localStorage.removeItem("openboat_cart");
      setPhase("payment");
      setSubmitting(false);
      setTimeout(
        () => paymentRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }),
        50,
      );
    } catch {
      setSubmitError("Something went wrong. Please try again.");
      setSubmitting(false);
    }
  }

  if (!initialized && items.length === 0) {
    // Wait for localStorage read before showing empty state
    return (
      <div style={{ maxWidth: 1440, margin: "0 auto", borderLeft: "2px solid #cdd6da", borderRight: "2px solid #cdd6da", minHeight: "100vh", background: "#eef1f0" }}>
        <BookingNav operatorName={operatorName} dockAddress={dockAddress} phone={phone} step={2} />
      </div>
    );
  }

  if (items.length === 0 && phase === "contact") {
    return (
      <div style={{ maxWidth: 1440, margin: "0 auto", borderLeft: "2px solid #cdd6da", borderRight: "2px solid #cdd6da", minHeight: "100vh", background: "#eef1f0" }}>
        <BookingNav operatorName={operatorName} dockAddress={dockAddress} phone={phone} step={2} />
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
      </div>
    );
  }

  const displayTotal = meta?.totalCents ?? totalCents;

  return (
    <div
      className="font-archivo"
      style={{ maxWidth: 1440, margin: "0 auto", borderLeft: "2px solid #cdd6da", borderRight: "2px solid #cdd6da", minHeight: "100vh", background: "#eef1f0" }}
    >
      <BookingNav operatorName={operatorName} dockAddress={dockAddress} phone={phone} step={2} />

      <div style={{ maxWidth: 760, margin: "0 auto", padding: "34px 24px 90px" }}>
        {/* Back link */}
        <a
          href="/book"
          style={{ fontFamily: "var(--font-ibm-plex-mono)", fontSize: 12, letterSpacing: ".1em", color: "#8c3b12", textDecoration: "underline", background: "none", border: "none", cursor: "pointer" }}
        >
          ← ADD ANOTHER TRIP
        </a>

        {/* H1 */}
        <h1
          style={{ margin: "16px 0 0", fontFamily: "var(--font-archivo)", fontSize: "clamp(28px, 4vw, 40px)", fontWeight: 700, textTransform: "uppercase", letterSpacing: "-.02em", lineHeight: 1, color: "#0d1c26" }}
        >
          One page. Then you&apos;re fishing.
        </h1>

        {/* Order card */}
        <OrderCard items={items} totalCents={displayTotal} />

        {/* Contact + payment section */}
        <div>
          <div
            style={{ fontFamily: "var(--font-ibm-plex-mono)", fontSize: 12, letterSpacing: ".16em", color: "#41565f", margin: "34px 0 12px" }}
          >
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
              disabled={phase === "payment"}
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
              disabled={phase === "payment"}
              autoComplete="tel"
              inputMode="numeric"
            />
          </div>

          <div style={{ marginTop: 16 }}>
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
              disabled={phase === "payment"}
              autoComplete="email"
            />
          </div>

          {/* Payment section */}
          <div ref={paymentRef}>
            <div
              style={{ fontFamily: "var(--font-ibm-plex-mono)", fontSize: 12, letterSpacing: ".16em", color: "#41565f", margin: "34px 0 12px" }}
            >
              PAYMENT
            </div>

            {phase === "contact" ? (
              <>
                {submitError && (
                  <div
                    style={{ fontFamily: "var(--font-archivo)", fontSize: 14, color: "#8c3b12", background: "#fff", border: "1px solid #8c3b12", padding: "12px 16px", marginBottom: 12 }}
                  >
                    {submitError}
                  </div>
                )}
                <button
                  type="button"
                  onClick={handleContactSubmit}
                  disabled={submitting}
                  style={{
                    marginTop: 10,
                    width: "100%",
                    background: submitting ? "#b1440f" : "#d1541f",
                    color: "#fff",
                    border: "none",
                    fontFamily: "var(--font-archivo)",
                    fontSize: 20,
                    fontWeight: 700,
                    letterSpacing: ".06em",
                    textTransform: "uppercase",
                    padding: 24,
                    cursor: submitting ? "not-allowed" : "pointer",
                  }}
                >
                  {submitting ? "PROCESSING…" : `Pay ${fmtDollars(totalCents)} · book my seats`}
                </button>
              </>
            ) : clientSecret && meta ? (
              <div style={{ background: "#fff", border: "1px solid #cdd6da", padding: 20 }}>
                <Elements
                  stripe={stripePromise}
                  options={{
                    clientSecret,
                    appearance: {
                      theme: "flat",
                      variables: {
                        colorPrimary: "#d1541f",
                        colorBackground: "#ffffff",
                        colorText: "#0d1c26",
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
                          border: "1px solid #d1541f",
                          outline: "2px solid #d1541f",
                          outlineOffset: "2px",
                        },
                        ".Label": {
                          fontFamily: "Archivo, Helvetica, sans-serif",
                          fontWeight: "600",
                          fontSize: "14px",
                          color: "#0d1c26",
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
                  <CheckoutForm
                    totalCents={meta.totalCents}
                    confirmationCode={meta.confirmationCode}
                    customerEmail={email.trim()}
                    customerPhone={mobile.trim()}
                    bookingId={meta.bookingId}
                    holdExpiresAt={meta.holdExpiresAt}
                    cartItems={items}
                  />
                </Elements>
              </div>
            ) : null}
          </div>

          {/* Reassurance — always visible */}
          <div
            style={{ display: "flex", flexWrap: "wrap", gap: "8px 22px", marginTop: 14, fontFamily: "var(--font-ibm-plex-mono)", fontSize: 11, letterSpacing: ".06em", color: "#41565f" }}
          >
            <span>FREE CANCELLATION TO 24H BEFORE SAILING</span>
            <span>WEATHER CANCELLATION = AUTOMATIC REFUND</span>
            <span>SECURED BY STRIPE</span>
          </div>
        </div>
      </div>
    </div>
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
