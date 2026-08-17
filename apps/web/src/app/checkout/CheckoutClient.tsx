"use client";

import { useState, useEffect, useRef, Suspense } from "react";
import { loadStripe } from "@stripe/stripe-js";
import { Elements } from "@stripe/react-stripe-js";
import { CheckoutForm } from "./CheckoutForm";
import posthog from "posthog-js";
import type { EnrichedCartItem } from "@/components/BookingCalendar";
import { dollars } from "@openboat/utils";
import { fmtTimeET } from "@/lib/format";

const stripePromise = loadStripe(process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY!);

function fmtDate(d: string) {
  return new Date(d + "T12:00:00Z").toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
}

function ArrowRight() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M5 12h14" />
      <path d="m12 5 7 7-7 7" />
    </svg>
  );
}

function Stepper({
  value,
  onChange,
  max,
  label,
}: {
  value: number;
  onChange: (n: number) => void;
  max: number;
  label: string;
}) {
  return (
    <div className="flex items-center gap-3" role="group" aria-label={`${label} quantity`}>
      <button
        type="button"
        onClick={() => onChange(Math.max(0, value - 1))}
        disabled={value === 0}
        aria-label={`Decrease ${label.toLowerCase()} count`}
        className={`w-9 h-9 rounded-pill flex items-center justify-center text-lg transition-colors ${value === 0 ? "border border-hairline text-disabled-text cursor-default" : "border-[1.5px] border-teal text-teal"}`}
      >
        −
      </button>
      <span
        className="font-grotesk text-[17px] font-semibold w-5 text-center"
        aria-live="polite"
        aria-atomic="true"
      >
        {value}
      </span>
      <button
        type="button"
        onClick={() => onChange(Math.min(max, value + 1))}
        disabled={value >= max}
        aria-label={`Increase ${label.toLowerCase()} count`}
        className="w-9 h-9 rounded-pill bg-teal text-white flex items-center justify-center text-lg hover:bg-teal-hover transition-colors disabled:bg-disabled disabled:text-disabled-text"
      >
        +
      </button>
    </div>
  );
}

function TripCard({
  item,
  onQtyChange,
  onRemove,
  locked,
}: {
  item: EnrichedCartItem;
  onQtyChange: (type: "adult" | "child", qty: number) => void;
  onRemove: () => void;
  locked: boolean;
}) {
  return (
    <div className="bg-white rounded-card border border-card-border p-5">
      <div className="flex items-start gap-3 mb-4">
        <div
          className="w-1 self-stretch rounded-pill flex-shrink-0 mt-0.5"
          style={{ backgroundColor: item.vesselColor }}
        />
        <div className="flex-1 min-w-0">
          <div className="text-[11px] font-bold uppercase tracking-[0.08em] text-teal mb-0.5">
            {item.category}
          </div>
          <div className="font-grotesk text-[15px] font-semibold text-ink">{item.productName}</div>
          <div className="text-[13px] text-muted mt-0.5">{item.vesselName}</div>
          <div className="text-[13px] text-muted">{fmtDate(item.departureDate)}</div>
          <div className="text-[13px] text-muted">
            {fmtTimeET(item.startTime)} – {fmtTimeET(item.endTime)}
          </div>
        </div>
        {!locked && (
          <button
            type="button"
            onClick={onRemove}
            aria-label={`Remove ${item.productName} from cart`}
            className="text-[13px] text-faint hover:text-error transition-colors flex-shrink-0"
          >
            Remove
          </button>
        )}
      </div>

      <div className="space-y-4 pt-4 border-t border-hairline">
        {item.tickets.map((ticket) => {
          const otherQty = item.tickets
            .filter((t) => t.ticketType !== ticket.ticketType)
            .reduce((s, t) => s + t.quantity, 0);
          return (
            <div key={ticket.ticketType} className="flex items-center justify-between gap-4">
              <div className="flex-shrink-0">
                <div className="text-[14px] font-semibold text-ink capitalize">
                  {ticket.ticketType}
                </div>
                <div className="text-[12px] text-faint">{dollars(ticket.priceCents)} each</div>
              </div>
              {locked ? (
                <div className="font-grotesk text-[15px] font-semibold text-ink">
                  {ticket.quantity} × {dollars(ticket.priceCents)}
                </div>
              ) : (
                <div className="flex items-center gap-4">
                  <Stepper
                    value={ticket.quantity}
                    onChange={(n) => onQtyChange(ticket.ticketType, n)}
                    max={item.seatsRemaining - otherQty}
                    label={ticket.ticketType.charAt(0).toUpperCase() + ticket.ticketType.slice(1)}
                  />
                  <div className="w-[64px] text-right font-grotesk text-[15px] font-semibold text-ink">
                    {dollars(ticket.priceCents * ticket.quantity)}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function CheckoutInner({ operatorName }: { operatorName: string }) {
  const [items, setItems] = useState<EnrichedCartItem[]>([]);
  const [phase, setPhase] = useState<"order" | "payment">("order");

  // contact form fields
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [showName, setShowName] = useState(false);
  const [name, setName] = useState("");

  // payment phase state
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [meta, setMeta] = useState<{
    totalCents: number;
    confirmationCode: string;
    ticketCount: number;
    bookingId: string;
    holdExpiresAt: string;
  } | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const paymentRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    try {
      const raw = localStorage.getItem("openboat_cart");
      if (raw) setItems(JSON.parse(raw));
    } catch {
      /* ignore */
    }
    posthog.capture("checkout_view");
  }, []);

  useEffect(() => {
    if (items.length === 0) return;
    localStorage.setItem("openboat_cart", JSON.stringify(items));
  }, [items]);

  function setQty(tripId: string, ticketType: "adult" | "child", qty: number) {
    setItems((prev) =>
      prev
        .map((item) => {
          if (item.tripId !== tripId) return item;
          const tickets =
            qty === 0
              ? item.tickets.filter((t) => t.ticketType !== ticketType)
              : item.tickets.map((t) =>
                  t.ticketType === ticketType ? { ...t, quantity: qty } : t,
                );
          return { ...item, tickets };
        })
        .filter((item) => item.tickets.length > 0),
    );
  }

  function removeTrip(tripId: string) {
    setItems((prev) => prev.filter((item) => item.tripId !== tripId));
  }

  const totalCents = items.reduce(
    (sum, item) => sum + item.tickets.reduce((s, t) => s + t.priceCents * t.quantity, 0),
    0,
  );
  const totalTickets = items.reduce(
    (sum, item) => sum + item.tickets.reduce((s, t) => s + t.quantity, 0),
    0,
  );

  async function handleContactSubmit(e: React.FormEvent) {
    e.preventDefault();
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
          customerName: name.trim() || null,
          customerEmail: email.trim(),
          customerPhone: phone.trim() || null,
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
        ticketCount: data.ticketCount,
        bookingId: data.bookingId,
        holdExpiresAt: data.holdExpiresAt,
      });
      localStorage.removeItem("openboat_cart");
      setPhase("payment");
      setTimeout(
        () => paymentRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }),
        50,
      );
    } catch {
      setSubmitError("Something went wrong. Please try again.");
      setSubmitting(false);
    }
  }

  const nav = (
    <header className="sticky top-0 z-20 bg-white/95 backdrop-blur-[14px] border-b border-hairline h-[60px] flex items-center px-5 md:px-8 gap-3">
      <a href="/" className="flex items-center gap-3" aria-label={`${operatorName} home`}>
        <div className="w-[34px] h-[34px] rounded-[10px] bg-teal flex items-center justify-center" aria-hidden="true">
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="white"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M2 20a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2" />
            <path d="M4 20l2-8h12l2 8" />
            <path d="M12 4v8" />
            <path d="M8 8h8" />
          </svg>
        </div>
        <span className="font-grotesk text-[17px] font-semibold text-ink">{operatorName}</span>
      </a>
    </header>
  );

  if (items.length === 0 && phase === "order") {
    return (
      <div className="min-h-screen bg-surface font-jakarta">
        {nav}
        <div className="flex flex-col items-center justify-center py-24 text-center px-5">
          <div className="font-grotesk text-[18px] font-semibold text-ink mb-2">
            Your cart is empty
          </div>
          <div className="text-[14px] text-muted mb-6">Select a trip to add tickets.</div>
          <a
            href="/"
            className="inline-flex items-center gap-2 px-6 py-3 rounded-btn bg-teal text-white font-grotesk font-semibold hover:bg-teal-hover transition-colors"
          >
            Browse trips <ArrowRight />
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-surface font-jakarta">
      {nav}

      <div className="max-w-lg mx-auto px-5 py-8 pb-16">
        {/* ── Order summary ────────────────────────────────────────── */}
        <h1 className="font-grotesk text-[22px] font-semibold text-ink mb-5">Checkout</h1>

        <div className="space-y-4 mb-6">
          {items.map((item) => (
            <TripCard
              key={item.tripId}
              item={item}
              onQtyChange={(type, qty) => setQty(item.tripId, type, qty)}
              onRemove={() => removeTrip(item.tripId)}
              locked={phase === "payment"}
            />
          ))}
        </div>

        <div className="bg-white rounded-card border border-card-border p-5 mb-8">
          <div className="flex justify-between items-center">
            <div>
              <div className="text-[11px] font-bold uppercase tracking-widest text-faint mb-0.5">
                Order total
              </div>
              <div className="font-grotesk text-[28px] font-bold text-ink">
                {dollars(meta?.totalCents ?? totalCents)}
              </div>
            </div>
            <div className="text-[13px] text-muted">
              {meta?.ticketCount ?? totalTickets} ticket
              {(meta?.ticketCount ?? totalTickets) !== 1 ? "s" : ""}
            </div>
          </div>
        </div>

        {/* ── Contact form ─────────────────────────────────────────── */}
        {phase === "order" && (
          <form onSubmit={handleContactSubmit} className="mb-8">
            <h2 className="font-grotesk text-[18px] font-semibold text-ink mb-4">Your details</h2>

            <div className="space-y-3 mb-4">
              <div>
                <label htmlFor="checkout-email" className="text-[11px] font-bold uppercase tracking-wide text-faint block mb-1.5">
                  Email
                </label>
                <input
                  id="checkout-email"
                  required
                  type="email"
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="jane@example.com"
                  className="w-full px-4 py-3 rounded-[12px] border border-card-border text-[15px] text-ink placeholder:text-faint focus:outline-none focus:border-teal transition-colors"
                />
              </div>
              <div>
                <label htmlFor="checkout-phone" className="text-[11px] font-bold uppercase tracking-wide text-faint block mb-1.5">
                  Mobile (for text updates)
                </label>
                <input
                  id="checkout-phone"
                  type="tel"
                  autoComplete="tel"
                  inputMode="numeric"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="(555) 000-0000"
                  className="w-full px-4 py-3 rounded-[12px] border border-card-border text-[15px] text-ink placeholder:text-faint focus:outline-none focus:border-teal transition-colors"
                />
              </div>

              {showName ? (
                <div>
                  <label htmlFor="checkout-name" className="text-[11px] font-bold uppercase tracking-wide text-faint block mb-1.5">
                    Full name (optional)
                  </label>
                  <input
                    id="checkout-name"
                    type="text"
                    autoComplete="name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Jane Smith"
                    className="w-full px-4 py-3 rounded-[12px] border border-card-border text-[15px] text-ink placeholder:text-faint focus:outline-none focus:border-teal transition-colors"
                  />
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setShowName(true)}
                  className="text-[13px] text-teal underline underline-offset-2"
                >
                  + Add a name (optional)
                </button>
              )}
            </div>

            {submitError && (
              <div className="text-red-600 text-sm bg-red-50 border border-red-200 rounded-lg px-4 py-3 mb-4">
                {submitError}
              </div>
            )}

            <button
              type="submit"
              disabled={submitting}
              className="w-full py-4 rounded-btn bg-teal text-white font-grotesk text-[15px] font-semibold hover:bg-teal-hover transition-colors flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {submitting ? (
                "Preparing payment…"
              ) : (
                <>
                  Continue to payment <ArrowRight />
                </>
              )}
            </button>

            <a
              href="/"
              className="block text-center text-[13px] text-muted mt-4 underline hover:text-ink transition-colors"
            >
              ← Continue shopping
            </a>
          </form>
        )}

        {/* ── Payment ──────────────────────────────────────────────── */}
        {phase === "payment" && clientSecret && meta && (
          <div ref={paymentRef}>
            <h2 className="font-grotesk text-[18px] font-semibold text-ink mb-4">Payment</h2>
            <div className="bg-white rounded-card border border-card-border p-5">
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
                  customerEmail={email.trim()}
                  customerPhone={phone.trim()}
                  bookingId={meta.bookingId}
                  holdExpiresAt={meta.holdExpiresAt}
                  cartItems={items}
                />
              </Elements>
            </div>
          </div>
        )}
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
