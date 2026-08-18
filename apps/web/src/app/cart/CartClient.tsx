"use client";

import { useState, useEffect } from "react";
import { ContactOverlay } from "@/components/ContactOverlay";
import type { EnrichedCartItem } from "@/components/BookingCalendar";
import { dollars } from "@openboat/utils";
import { fmtTimeET } from "@/lib/format";

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
        className={`w-9 h-9 rounded-pill flex items-center justify-center text-lg transition-colors ${
          value === 0
            ? "border border-hairline text-disabled-text cursor-default"
            : "border-1.5 border-gold text-gold"
        }`}
      >
        −
      </button>
      <span
        className="font-grotesk text-17 font-semibold w-5 text-center"
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
        className="w-9 h-9 rounded-pill bg-gold text-navy flex items-center justify-center text-lg hover:bg-gold-hover transition-colors disabled:bg-disabled disabled:text-disabled-text"
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
}: {
  item: EnrichedCartItem;
  onQtyChange: (type: "adult" | "child", qty: number) => void;
  onRemove: () => void;
}) {
  return (
    <div className="bg-white rounded-card border border-card-border p-5">
      <div className="flex items-start gap-3 mb-4">
        <div
          className="w-1 self-stretch rounded-pill flex-shrink-0 mt-0.5"
          style={{ backgroundColor: item.vesselColor }}
        />
        <div className="flex-1 min-w-0">
          <div className="text-11 font-bold uppercase tracking-label text-gold mb-0.5">
            {item.category}
          </div>
          <div className="font-grotesk text-15 font-semibold text-ink">{item.productName}</div>
          <div className="text-13 text-muted mt-0.5">{item.vesselName}</div>
          <div className="text-13 text-muted">{fmtDate(item.departureDate)}</div>
          <div className="text-13 text-muted">
            {fmtTimeET(item.startTime)} – {fmtTimeET(item.endTime)}
          </div>
        </div>
        <button
          type="button"
          onClick={onRemove}
          aria-label={`Remove ${item.productName} from cart`}
          className="text-13 text-faint hover:text-error transition-colors flex-shrink-0"
        >
          Remove
        </button>
      </div>

      <div className="space-y-4 pt-4 border-t border-hairline">
        {item.tickets.map((ticket) => {
          const otherQty = item.tickets
            .filter((t) => t.ticketType !== ticket.ticketType)
            .reduce((s, t) => s + t.quantity, 0);
          return (
            <div key={ticket.ticketType} className="flex items-center justify-between gap-4">
              <div className="flex-shrink-0">
                <div className="text-14 font-semibold text-ink capitalize">
                  {ticket.ticketType}
                </div>
                <div className="text-12 text-faint">{dollars(ticket.priceCents)} each</div>
              </div>
              <div className="flex items-center gap-4">
                <Stepper
                  value={ticket.quantity}
                  onChange={(n) => onQtyChange(ticket.ticketType, n)}
                  max={item.seatsRemaining - otherQty}
                  label={ticket.ticketType.charAt(0).toUpperCase() + ticket.ticketType.slice(1)}
                />
                <div className="w-[64px] text-right font-grotesk text-15 font-semibold text-ink">
                  {dollars(ticket.priceCents * ticket.quantity)}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function CartClient({ operatorName }: { operatorName: string }) {
  const [items, setItems] = useState<EnrichedCartItem[]>([]);
  const [showContact, setShowContact] = useState(false);

  // Load cart from localStorage after hydration
  useEffect(() => {
    try {
      const raw = localStorage.getItem("openboat_cart");
      if (raw) setItems(JSON.parse(raw));
    } catch {
      /* ignore */
    }
  }, []);

  // Keep localStorage in sync when quantities are edited in the cart
  useEffect(() => {
    if (items.length === 0) {
      localStorage.removeItem("openboat_cart");
    } else {
      localStorage.setItem("openboat_cart", JSON.stringify(items));
    }
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

  function handleCheckout(name: string, email: string, phone: string) {
    const cartItems = items.map((item) => ({
      tripId: item.tripId,
      tickets: item.tickets.map((t) => ({ ticketType: t.ticketType, quantity: t.quantity })),
    }));
    sessionStorage.setItem(
      "openboat_checkout",
      JSON.stringify({ cart: cartItems, name, email, phone }),
    );
    window.location.href = "/checkout";
  }

  const totalCents = items.reduce(
    (sum, item) => sum + item.tickets.reduce((s, t) => s + t.priceCents * t.quantity, 0),
    0,
  );
  const totalTickets = items.reduce(
    (sum, item) => sum + item.tickets.reduce((s, t) => s + t.quantity, 0),
    0,
  );

  const nav = (
    <header className="sticky top-0 z-20 bg-white/95 backdrop-blur-glass border-b border-hairline h-navbar flex items-center px-5 md:px-8 gap-3">
      <a href="/" className="flex items-center gap-3" aria-label={`${operatorName} home`}>
        <div className="w-logo h-logo rounded-icon bg-navy flex items-center justify-center" aria-hidden="true">
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
        <span className="font-grotesk text-17 font-semibold text-ink">{operatorName}</span>
      </a>
    </header>
  );

  if (items.length === 0) {
    return (
      <div className="min-h-screen bg-surface font-jakarta">
        {nav}
        <div className="flex flex-col items-center justify-center py-24 text-center px-5">
          <div className="font-grotesk text-18 font-semibold text-ink mb-2">
            Your cart is empty
          </div>
          <div className="text-14 text-muted mb-6">Select a trip to add tickets.</div>
          <a
            href="/"
            className="inline-flex items-center gap-2 px-6 py-3 rounded-btn bg-gold text-navy font-grotesk font-semibold hover:bg-gold-hover transition-colors"
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

      <div className="max-w-lg mx-auto px-5 py-8 pb-32">
        <h1 className="font-grotesk text-22 font-semibold text-ink mb-5">Your cart</h1>

        <div className="space-y-4 mb-6">
          {items.map((item) => (
            <TripCard
              key={item.tripId}
              item={item}
              onQtyChange={(type, qty) => setQty(item.tripId, type, qty)}
              onRemove={() => removeTrip(item.tripId)}
            />
          ))}
        </div>

        <div className="bg-white rounded-card border border-card-border p-5 mb-6">
          <div className="flex justify-between items-center">
            <div>
              <div className="text-11 font-bold uppercase tracking-widest text-faint mb-0.5">
                Order total
              </div>
              <div className="font-grotesk text-28 font-bold text-ink">
                {dollars(totalCents)}
              </div>
            </div>
            <div className="text-13 text-muted">
              {totalTickets} ticket{totalTickets !== 1 ? "s" : ""}
            </div>
          </div>
        </div>

        <button
          type="button"
          onClick={() => setShowContact(true)}
          className="w-full py-4 rounded-btn bg-gold text-navy font-grotesk text-15 font-semibold hover:bg-gold-hover transition-colors flex items-center justify-center gap-2"
        >
          Checkout <ArrowRight />
        </button>

        <a
          href="/"
          className="block text-center text-13 text-muted mt-4 underline hover:text-ink transition-colors"
        >
          ← Continue shopping
        </a>

        <p className="text-11 text-faint text-center mt-4">
          Purchasing tickets means you accept the{" "}
          <a href="/terms" className="underline text-gold">
            terms and conditions
          </a>
          .
        </p>
      </div>

      {showContact && (
        <ContactOverlay
          totalCents={totalCents}
          ticketCount={totalTickets}
          onSubmit={(name, email, phone) => {
            setShowContact(false);
            handleCheckout(name, email, phone);
          }}
          onClose={() => setShowContact(false)}
        />
      )}
    </div>
  );
}
