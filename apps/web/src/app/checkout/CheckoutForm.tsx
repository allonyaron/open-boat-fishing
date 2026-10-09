"use client";

import { useState, useEffect, useRef } from "react";
import { PaymentElement, useStripe, useElements } from "@stripe/react-stripe-js";
import type { Stripe, StripeElements } from "@stripe/stripe-js";
import {
  type StoredHold,
  cartKey,
  clearHold,
  confirmationUrl,
  holdHeaders,
  isLive,
  loadHold,
  releaseHold,
  saveHold,
} from "@/lib/checkout/stored-hold";
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

function HoldBanner({ holdExpiresAt, onExpire }: { holdExpiresAt: string; onExpire: () => void }) {
  const [msLeft, setMsLeft] = useState(() => new Date(holdExpiresAt).getTime() - Date.now());

  useEffect(() => {
    const tick = () => setMsLeft(new Date(holdExpiresAt).getTime() - Date.now());
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [holdExpiresAt]);

  const expired = msLeft <= 0;
  const onExpireRef = useRef(onExpire);
  onExpireRef.current = onExpire;
  useEffect(() => {
    if (expired) onExpireRef.current();
  }, [expired]);

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
        {expired ? "HOLD EXPIRED" : fmtCountdown(msLeft)}
      </span>
    </div>
  );
}

// ─── Checkout form — one page, one button, one commitment ─────────────────────

type Prepared =
  | { kind: "ready"; hold: StoredHold }
  // answered: the server responded, so it has dealt with any `replaces`.
  | { kind: "error"; message: string; answered: boolean }
  | { kind: "paid"; hold: StoredHold };

const SOMETHING_WRONG = "Something went wrong. Please try again.";
const HOLD_RAN_OUT = "Your seat hold ran out and the seats were released. Pay again to check they're still free.";

export function CheckoutForm({ items }: { items: EnrichedCartItem[] }) {
  const stripe = useStripe();
  const elements = useElements();

  const [name, setName] = useState("");
  const [mobile, setMobile] = useState("");
  const [email, setEmail] = useState("");
  const [touched, setTouched] = useState({ name: false, mobile: false, email: false });
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  // The booking from the first Pay press, mirrored to sessionStorage. A retry
  // after a decline or a closed 3DS window confirms the same PI again instead
  // of holding the seats twice (P2-3); a reload picks it back up.
  const [attempt, setAttempt] = useState<StoredHold | null>(null);
  const [releasing, setReleasing] = useState(false);
  const submittingRef = useRef(false);
  const key = cartKey(items);

  useEffect(() => {
    if (attempt) saveHold(attempt);
  }, [attempt]);

  // A page restored from the back-forward cache runs no effects, and another
  // page may have released the saved booking meanwhile: re-read it.
  useEffect(() => {
    function onPageShow(e: PageTransitionEvent) {
      if (!e.persisted) return;
      const stored = loadHold();
      setAttempt(stored && stored.cartKey === key ? stored : null);
    }
    window.addEventListener("pageshow", onPageShow);
    return () => window.removeEventListener("pageshow", onPageShow);
  }, [key]);

  // On load: resume this tab's booking if it is still a live hold for this
  // cart; otherwise give its seats back before anything else happens.
  useEffect(() => {
    const stored = loadHold();
    if (!stored) return;
    if (stored.cartKey === key && isLive(stored)) {
      setAttempt(stored);
      return;
    }
    setReleasing(true);
    void releaseHold(stored).then((result) => {
      if (result === "paid") {
        window.location.href = confirmationUrl(stored);
        return;
      }
      clearHold();
      setReleasing(false);
    });
    // Once, on load: later cart changes happen on other pages.
  }, []);

  const nameError = touched.name && !name.trim() ? "Name is required" : null;
  const mobileError = touched.mobile && mobile && !validatePhone(mobile) ? "Enter a 10-digit US number" : null;
  const emailError = touched.email && !validateEmail(email) ? "Enter a valid email address" : null;

  const totalCents = items.reduce(
    (sum, item) => sum + item.tickets.reduce((s, t) => s + t.priceCents * t.quantity, 0),
    0,
  );

  function contactBody() {
    return {
      customerName: name.trim(),
      customerEmail: email.trim(),
      customerPhone: mobile.trim() || null,
    };
  }

  // Gives the held seats back; the next Pay press books afresh. If the booking
  // turns out to be paid, it stays saved so the confirmation page can clear
  // the cart.
  async function releaseAttempt(a: StoredHold): Promise<"released" | "paid"> {
    setAttempt(null);
    const result = await releaseHold(a);
    if (result === "released") clearHold();
    return result;
  }

  async function handleHoldExpired() {
    // A payment in flight owns the attempt; its result decides what happens next.
    if (!attempt || submittingRef.current) return;
    setReleasing(true);
    const result = await releaseAttempt(attempt);
    if (result === "paid") {
      window.location.href = confirmationUrl(attempt);
      return;
    }
    setReleasing(false);
    setSubmitError(HOLD_RAN_OUT);
  }

  // Books the cart. `replaces` is this checkout's previous booking, which the
  // server releases in the same request.
  async function createBooking(replaces: StoredHold | null): Promise<Prepared> {
    const cart = items.map((item) => ({
      tripId: item.tripId,
      tickets: item.tickets.map((t) => ({ ticketType: t.ticketType, quantity: t.quantity })),
    }));

    let data: {
      error?: string;
      code?: string;
      clientSecret?: string;
      confirmationCode?: string;
      bookingId?: string;
      holdExpiresAt?: string;
      holdToken?: string;
    };
    try {
      const res = await fetch("/api/bookings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          cart,
          ...contactBody(),
          notes: null,
          replaces: replaces && { bookingId: replaces.bookingId, holdToken: replaces.holdToken },
        }),
      });
      data = await res.json();
    } catch {
      // No answer (offline, or a non-JSON error page): the previous booking
      // may be untouched, so keep it and replace it on the next press.
      return { kind: "error", message: SOMETHING_WRONG, answered: false };
    }

    if (data.code === "replaced_booking_paid" && replaces) return { kind: "paid", hold: replaces };
    if (data.error || !data.clientSecret || !data.confirmationCode || !data.bookingId || !data.holdExpiresAt || !data.holdToken) {
      return { kind: "error", message: data.error ?? SOMETHING_WRONG, answered: true };
    }
    return {
      kind: "ready",
      hold: {
        bookingId: data.bookingId,
        clientSecret: data.clientSecret,
        confirmationCode: data.confirmationCode,
        holdExpiresAt: data.holdExpiresAt,
        holdToken: data.holdToken,
        cartKey: key,
      },
    };
  }

  // Reuses the current attempt when its hold is still live, after saving the
  // contact details as they are now. Otherwise books afresh, replacing it.
  async function prepareAttempt(): Promise<Prepared> {
    if (attempt && isLive(attempt)) {
      // Awaited: the confirmation email goes to whatever address the booking has.
      const res = await fetch(`/api/bookings/${attempt.bookingId}/contact`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", ...holdHeaders(attempt) },
        body: JSON.stringify(contactBody()),
      }).catch(() => null);
      if (!res) return { kind: "error", message: SOMETHING_WRONG, answered: false };
      if (res.ok) return { kind: "ready", hold: attempt };
      if (res.status !== 404) {
        const data = await res.json().catch(() => ({}));
        return { kind: "error", message: data.error ?? SOMETHING_WRONG, answered: false };
      }
      // 404: the booking stopped being a live hold. Replace it below.
    }
    const prepared = await createBooking(attempt);
    // Once the server has answered, it has released the previous booking (or
    // found it paid), so drop it.
    if (prepared.kind === "error" && prepared.answered && attempt) {
      setAttempt(null);
      clearHold();
    }
    return prepared;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setTouched({ name: true, mobile: true, email: true });
    if (!name.trim() || !validateEmail(email) || (mobile && !validatePhone(mobile))) return;
    if (!stripe || !elements || submitting || releasing) return;

    setSubmitting(true);
    submittingRef.current = true;
    setSubmitError(null);
    try {
      await pay(stripe, elements);
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  }

  async function pay(stripe: Stripe, elements: StripeElements) {
    // Runs before every confirm, retries included (deferred-intent Elements).
    const { error: elementsError } = await elements.submit();
    if (elementsError) {
      setSubmitError(elementsError.message ?? "Check the payment details above.");
      return;
    }

    posthog.capture("payment_attempt", { total_cents: totalCents, retry: attempt !== null });

    const prepared = await prepareAttempt();
    if (prepared.kind === "paid") {
      window.location.href = confirmationUrl(prepared.hold);
      return;
    }
    if (prepared.kind === "error") {
      setSubmitError(prepared.message);
      return;
    }
    const current = prepared.hold;
    setAttempt(current);

    // Extend the hold before handing off to Stripe so a 3DS challenge or wallet
    // sheet doesn't race the expiry. The banner shows the extended time.
    fetch(`/api/bookings/${current.bookingId}/extend-hold`, { method: "PATCH", headers: holdHeaders(current) })
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { holdExpiresAt?: string } | null) => {
        if (!data?.holdExpiresAt) return;
        setAttempt((a) => (a?.bookingId === current.bookingId ? { ...a, holdExpiresAt: data.holdExpiresAt! } : a));
      })
      .catch(() => {});

    const { error: payError } = await stripe.confirmPayment({
      elements,
      clientSecret: current.clientSecret,
      confirmParams: {
        return_url: `${window.location.origin}/booking/delivery?code=${current.confirmationCode}&email=${encodeURIComponent(email.trim())}&phone=${encodeURIComponent(mobile.trim())}`,
      },
    });

    if (payError) {
      posthog.capture("payment_failure", {
        total_cents: totalCents,
        error_code: payError.code,
        error_type: payError.type,
        error_message: payError.message,
      });
      if (payError.code === "payment_intent_unexpected_state") {
        // The PI was canceled (the hold expired and its seats were reclaimed).
        // Drop it so the next press books afresh.
        await releaseAttempt(current);
        setSubmitError(HOLD_RAN_OUT);
      } else {
        setSubmitError(payError.message ?? "Payment failed. Please try again.");
      }
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

      {attempt && <HoldBanner holdExpiresAt={attempt.holdExpiresAt} onExpire={handleHoldExpired} />}

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
        {/* Link is off (P2-5). Without this, a card-only intent still shows Link as a
            wallet, and Link's funding sources add "Bank" and "Klarna" tabs. */}
        <PaymentElement options={{ layout: "tabs", wallets: { link: "never" } }} />
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
        disabled={!stripe || !elements || submitting || releasing}
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
