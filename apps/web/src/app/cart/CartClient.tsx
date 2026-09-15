"use client";

import { useState, useEffect } from "react";
import type { EnrichedCartItem } from "@/components/BookingCalendar";
import { fmtTimeET } from "@/lib/format";

function fmtDate(d: string) {
  const dt = new Date(d + "T12:00:00Z");
  const dow = dt.toLocaleDateString("en-US", { weekday: "short", timeZone: "UTC" }).toUpperCase();
  const mon = dt.toLocaleDateString("en-US", { month: "short", timeZone: "UTC" }).toUpperCase();
  const day = dt.getUTCDate();
  return `${dow} ${mon} ${day}`;
}

function dollars(cents: number) {
  return `$${Math.round(cents / 100)}`;
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
  onQtyChange,
  onRemove,
}: {
  item: EnrichedCartItem;
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
            const subtotal = ticket.priceCents * ticket.quantity;
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
                    style={{ fontSize: 15, minWidth: 54, color: "#16354a" }}
                  >
                    {dollars(subtotal)}
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
  const [items, setItems] = useState<EnrichedCartItem[]>([]);

  useEffect(() => {
    try {
      const raw = localStorage.getItem("openboat_cart");
      if (raw) setItems(JSON.parse(raw));
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    if (items.length === 0) {
      localStorage.removeItem("openboat_cart");
    } else {
      localStorage.setItem("openboat_cart", JSON.stringify(items));
    }
  }, [items]);

  function setQty(tripId: string, ticketType: string, qty: number) {
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
              onQtyChange={(type, qty) => setQty(item.tripId, type, qty)}
              onRemove={() => removeTrip(item.tripId)}
            />
          ))}
        </div>

        {/* Order total */}
        <div
          className="bg-hull flex items-center justify-between"
          style={{ marginTop: 16, padding: "18px 16px" }}
        >
          <span className="font-plex-mono" style={{ fontSize: 11, letterSpacing: ".16em", color: "#c9d6dd", fontWeight: 500 }}>
            ORDER TOTAL · {totalTickets} {totalTickets === 1 ? "TICKET" : "TICKETS"}
          </span>
          <span className="font-plex-mono font-bold text-white" style={{ fontSize: 30 }}>
            {dollars(totalCents)}
          </span>
        </div>

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
