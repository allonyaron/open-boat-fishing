"use client";

import { dollars } from "@openboat/utils";
import type { EnrichedCartItem } from "@/components/BookingCalendar";
import { toCartItem } from "@/components/BookingCalendar/useCart";
import { cart, useCartStore } from "@/lib/cart/store";
import { useQuote } from "@/lib/cart/quote";
import { quoteView, type QuoteView } from "@/lib/cart/quote-view";
import { fmtTimeET } from "@/lib/format";

function fmtDate(d: string) {
  const dt = new Date(d + "T12:00:00Z");
  const dow = dt.toLocaleDateString("en-US", { weekday: "short", timeZone: "UTC" }).toUpperCase();
  const mon = dt.toLocaleDateString("en-US", { month: "short", timeZone: "UTC" }).toUpperCase();
  const day = dt.getUTCDate();
  return `${dow} ${mon} ${day}`;
}

// ─── Square stepper (design spec) ────────────────────────────────────────────

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
  const canDec = value > 0;
  const canInc = value < max;
  const btnBase: React.CSSProperties = {
    width: 44,
    height: 44,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontFamily: "var(--font-archivo)",
    fontSize: 20,
    fontWeight: 500,
    color: "#fff",
    border: "none",
    cursor: "pointer",
  };

  return (
    <div
      role="group"
      aria-label={`${label} quantity`}
      style={{ display: "flex", alignItems: "stretch" }}
    >
      <button
        type="button"
        onClick={() => onChange(Math.max(0, value - 1))}
        disabled={!canDec}
        aria-label={`Decrease ${label} count`}
        style={{ ...btnBase, background: canDec ? "#16354a" : "#9aa8ae", boxShadow: "inset 0 0 0 1px #16354a" }}
      >
        −
      </button>
      <div
        aria-live="polite"
        style={{
          width: 44,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontFamily: "var(--font-ibm-plex-mono)",
          fontSize: 17,
          fontWeight: 700,
          color: "#16354a",
          boxShadow: "inset 0 1px 0 #16354a, inset 0 -1px 0 #16354a",
        }}
      >
        {value}
      </div>
      <button
        type="button"
        onClick={() => onChange(Math.min(max, value + 1))}
        disabled={!canInc}
        aria-label={`Increase ${label} count`}
        style={{ ...btnBase, background: canInc ? "#16354a" : "#9aa8ae", boxShadow: "inset 0 0 0 1px #16354a" }}
      >
        +
      </button>
    </div>
  );
}

// ─── Trip card ────────────────────────────────────────────────────────────────

function TripCard({
  item,
  quote,
  onQtyChange,
  onRemove,
}: {
  item: EnrichedCartItem;
  quote: QuoteView;
  onQtyChange: (type: string, qty: number) => void;
  onRemove: () => void;
}) {
  const timeRange = `${fmtTimeET(item.startTime)} – ${fmtTimeET(item.endTime)} · ${item.vesselName}`;

  return (
    <div
      className="bg-white font-archivo"
      style={{ boxShadow: "inset 0 0 0 1px #cdd6da", display: "flex" }}
    >
      {/* Type color bar */}
      <div style={{ width: 6, flexShrink: 0, background: item.vesselColor }} />

      <div style={{ flex: 1, minWidth: 0, padding: 14 }}>
        {/* Header row */}
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div
              className="font-plex-mono font-semibold"
              style={{ fontSize: 11, letterSpacing: ".14em", color: "#b1440f" }}
            >
              {item.category.toUpperCase()}
            </div>
            <div
              className="font-archivo font-bold"
              style={{ fontSize: 17, marginTop: 2, color: "#16354a" }}
            >
              {item.productName}
            </div>
            <div className="font-plex-mono" style={{ fontSize: 12, marginTop: 4, color: "#41565f" }}>
              {fmtDate(item.departureDate)} · {timeRange}
            </div>
          </div>
          <button
            type="button"
            onClick={onRemove}
            aria-label={`Remove ${item.productName}`}
            className="font-plex-mono"
            style={{ fontSize: 11, color: "#5b6f79", background: "none", border: "none", cursor: "pointer", textDecoration: "underline", flexShrink: 0, padding: "2px 0" }}
          >
            REMOVE
          </button>
        </div>

        {/* Fare rows */}
        <div style={{ marginTop: 14, borderTop: "1px solid #e3e9eb", paddingTop: 14 }}>
          {item.tickets.map((ticket) => {
            const otherQty = item.tickets
              .filter((t) => t.ticketType !== ticket.ticketType)
              .reduce((s, t) => s + t.quantity, 0);
            return (
              <div
                key={ticket.ticketType}
                className="flex items-center justify-between gap-3"
                style={{ marginBottom: 12 }}
              >
                <div style={{ minWidth: 0 }}>
                  <div
                    className="font-archivo font-semibold capitalize"
                    style={{ fontSize: 14, color: "#16354a" }}
                  >
                    {ticket.displayLabel ?? ticket.ticketType}
                  </div>
                  <div className="font-plex-mono" style={{ fontSize: 12, color: "#5b6f79" }}>
                    {dollars(ticket.priceCents)} each
                  </div>
                </div>
                <div className="flex items-center gap-3 flex-shrink-0">
                  <Stepper
                    value={ticket.quantity}
                    onChange={(n) => onQtyChange(ticket.ticketType, n)}
                    max={item.seatsRemaining - otherQty + ticket.quantity}
                    label={ticket.displayLabel ?? ticket.ticketType}
                  />
                  <div
                    className="font-plex-mono font-bold text-right"
                    style={{ fontSize: 15, minWidth: 54, color: "#16354a", opacity: quote.updating ? 0.5 : 1 }}
                  >
                    {quote.fareSubtotal(item.tripId, ticket.ticketType)}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ─── Cart client ──────────────────────────────────────────────────────────────

export function CartClient({ operatorName }: { operatorName: string }) {
  const { lines, ready, updatedOnRestore } = useCartStore();
  const quoteState = useQuote(lines);
  const quote = quoteView(quoteState);
  const items = lines.map(toCartItem);
  const totalTickets = items.reduce(
    (sum, item) => sum + item.tickets.reduce((s, t) => s + t.quantity, 0),
    0,
  );

  function setQty(tripId: string, ticketType: string, qty: number) {
    const line = lines.find((l) => l.trip.id === tripId);
    if (line) cart.set(line.trip, ticketType, qty);
  }

  // The stored cart is read after hydration; until then, render nothing
  // rather than flash the empty state.
  if (!ready) return <div className="min-h-screen bg-deck" />;

  if (items.length === 0) {
    return (
      <div className="min-h-screen bg-deck font-archivo">
        <div
          className="lg:hidden sticky top-0 z-50 flex items-center justify-between bg-hull"
          style={{ height: 54, padding: "0 16px", borderBottom: "3px solid #c94510" }}
        >
          <a href="/book" className="font-plex-mono font-semibold tracking-[.1em] uppercase" style={{ fontSize: 12, color: "#dfe8ec", textDecoration: "none" }}>
            ← TRIPS
          </a>
          <span className="font-plex-mono" style={{ fontSize: 11, letterSpacing: ".14em", color: "#c9d6dd" }}>STEP 2 OF 3 · CART</span>
        </div>
        <div className="flex flex-col items-center justify-center" style={{ minHeight: "60vh", padding: "60px 16px", textAlign: "center" }}>
          <div className="font-archivo font-bold" style={{ fontSize: 19, color: "#16354a" }}>
            Nothing aboard yet
          </div>
          <div className="font-archivo" style={{ fontSize: 14, color: "#41565f", marginTop: 8 }}>
            Pick a day, then pick a trip.
          </div>
          <a
            href="/book"
            className="font-archivo font-bold uppercase bg-orange hover:bg-orange-press transition-colors text-white"
            style={{ marginTop: 24, padding: "14px 28px", textDecoration: "none", fontSize: 15, letterSpacing: ".08em" }}
          >
            BROWSE TRIPS →
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-deck font-archivo">
      {/* Mobile header */}
      <div
        className="lg:hidden sticky top-0 z-50 flex items-center justify-between bg-hull"
        style={{ height: 54, padding: "0 16px", borderBottom: "3px solid #c94510" }}
      >
        <a href="/book" className="font-plex-mono font-semibold tracking-[.1em] uppercase" style={{ fontSize: 12, color: "#dfe8ec", textDecoration: "none" }}>
          ← TRIPS
        </a>
        <span className="font-plex-mono" style={{ fontSize: 11, letterSpacing: ".14em", color: "#c9d6dd" }}>STEP 2 OF 3 · CART</span>
      </div>

      <div style={{ maxWidth: 760, margin: "0 auto", padding: "0 16px 80px" }} className="lg:px-[34px]">
        <h1
          className="font-archivo font-bold uppercase"
          style={{ fontSize: 26, letterSpacing: "-.01em", padding: "22px 0 14px", color: "#16354a" }}
        >
          YOUR CART
        </h1>

        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {items.map((item) => (
            <TripCard
              key={item.tripId}
              item={item}
              quote={quote}
              onQtyChange={(type, qty) => setQty(item.tripId, type, qty)}
              onRemove={() => cart.remove(item.tripId)}
            />
          ))}
        </div>

        {updatedOnRestore && (
          <p role="status" className="font-archivo" style={{ marginTop: 12, fontSize: 13, color: "#41565f" }}>
            Your cart was updated to current prices and seats.
          </p>
        )}

        {quote.discountCents > 0 && (
          <div
            className="flex items-center justify-between font-plex-mono"
            style={{ marginTop: 16, padding: "12px 16px", background: "#fff", boxShadow: "inset 0 0 0 1px #cdd6da", color: "#186a4a", fontSize: 13, fontWeight: 600, letterSpacing: ".1em", opacity: quote.updating ? 0.5 : 1 }}
          >
            <span>GROUP DISCOUNT</span>
            <span>−{dollars(quote.discountCents)}</span>
          </div>
        )}

        {/* Order total */}
        <div
          className="bg-hull flex items-center justify-between"
          style={{ marginTop: quote.discountCents > 0 ? 0 : 16, padding: "18px 16px" }}
        >
          <span className="font-plex-mono" style={{ fontSize: 11, letterSpacing: ".16em", color: "#c9d6dd", fontWeight: 500 }}>
            ORDER TOTAL · {totalTickets} {totalTickets === 1 ? "TICKET" : "TICKETS"}
          </span>
          <span
            className="font-plex-mono font-bold text-white"
            aria-busy={quote.updating}
            style={{ fontSize: 30, opacity: quote.updating ? 0.5 : 1 }}
          >
            {quote.total}
          </span>
        </div>
        {quote.error && (
          <p role="alert" className="font-archivo" style={{ marginTop: 10, fontSize: 14, fontWeight: 600, color: "#8c3b12" }}>
            {quote.error}
          </p>
        )}

        {/* Checkout CTA */}
        <a
          href="/checkout"
          className="font-archivo font-bold uppercase bg-orange hover:bg-orange-press transition-colors text-white"
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            width: "100%",
            height: 58,
            marginTop: 10,
            textDecoration: "none",
            fontSize: 16,
            letterSpacing: ".08em",
          }}
        >
          CHECKOUT →
        </a>

        <a
          href="/book"
          className="font-archivo block text-center"
          style={{ marginTop: 14, fontSize: 13, color: "#41565f", textDecoration: "underline" }}
        >
          ← Add another trip
        </a>

        <p className="font-plex-mono text-center" style={{ marginTop: 14, fontSize: 11, color: "#5b6f79" }}>
          By booking you accept the{" "}
          <a href="/terms" style={{ color: "#b1440f", textDecoration: "underline" }}>TERMS</a>
          .
        </p>
      </div>
    </div>
  );
}
