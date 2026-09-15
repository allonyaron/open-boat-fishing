"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import posthog from "posthog-js";
import { fmtTimeET } from "@/lib/format";

// ─── Types ────────────────────────────────────────────────────────────────────

export type Trip = {
  id: string;
  departureDate: string;
  startTime: string;
  endTime: string;
  capacity: number;
  seatsRemaining: number;
  vessel: { name: string; color: string; code: string | null };
  product: {
    category: string;
    displayName: string;
    showRemaining: boolean;
    prices: { ticketType: string; priceCents: number }[];
  };
};

export type EnrichedCartItem = {
  tripId: string;
  departureDate: string;
  startTime: string;
  endTime: string;
  vesselName: string;
  vesselColor: string;
  category: string;
  productName: string;
  seatsRemaining: number;
  tickets: {
    ticketType: string;
    quantity: number;
    priceCents: number;
    displayLabel?: string;
  }[];
};

type VesselInfo = { name: string; color: string };

// ─── Helpers ──────────────────────────────────────────────────────────────────

const MONTHS = [
  "January","February","March","April","May","June",
  "July","August","September","October","November","December",
];
const MONTHS_SHORT = ["JAN","FEB","MAR","APR","MAY","JUN","JUL","AUG","SEP","OCT","NOV","DEC"];
const DAYS_SINGLE = ["S","M","T","W","T","F","S"];

function toMonthStr(year: number, mon: number) {
  return `${year}-${String(mon).padStart(2, "0")}`;
}
function parseMonth(month: string) {
  const [y, m] = month.split("-").map(Number);
  return { year: y, mon: m };
}
function fmtDuration(startIso: string, endIso: string) {
  const diffMs = new Date(endIso).getTime() - new Date(startIso).getTime();
  const totalMins = Math.round(diffMs / 60000);
  const hrs = Math.floor(totalMins / 60);
  const mins = totalMins % 60;
  return mins === 0 ? `${hrs} hr` : `${hrs} hr ${mins} min`;
}
function fmtDayLabel(dateStr: string): { main: string; sub: string } {
  const dt = new Date(dateStr + "T12:00:00Z");
  const today = new Date().toISOString().slice(0, 10);
  const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
  const dow = dt.toLocaleDateString("en-US", { weekday: "long", timeZone: "UTC" }).toUpperCase();
  const mon = dt.toLocaleDateString("en-US", { month: "long", timeZone: "UTC" }).toUpperCase();
  const day = dt.getUTCDate();
  const main = `${dow}, ${mon} ${day}`;
  const dow0 = dt.getUTCDay();
  const isWeekend = dow0 === 0 || dow0 === 6;
  let sub = "";
  if (dateStr === today) sub = "TODAY";
  else if (dateStr === tomorrow) sub = "TOMORROW";
  else if (isWeekend) sub = "WEEKEND";
  return { main, sub };
}
function dollars(cents: number) {
  return `$${Math.round(cents / 100)}`;
}
function fmtMonthDay(dateStr: string) {
  const dt = new Date(dateStr + "T12:00:00Z");
  return `${MONTHS_SHORT[dt.getUTCMonth()]} ${dt.getUTCDate()}`;
}
function fmtHoldTime(secs: number): string {
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function getDisplayPrices(prices: Trip["product"]["prices"]) {
  const active = prices.filter((p) => p.priceCents > 0);
  if (active.length === 0) return [];
  const allEqual = active.every((p) => p.priceCents === active[0].priceCents);
  if (allEqual) return [{ ...active[0], displayLabel: "seat" }];
  return active.map((p) => ({ ...p, displayLabel: p.ticketType }));
}

// ─── BookingNav ───────────────────────────────────────────────────────────────

export function BookingNav({
  operatorName,
  dockAddress,
  phone,
  step,
}: {
  operatorName: string;
  dockAddress: string | null;
  phone: string | null;
  step: 1 | 2 | 3;
}) {
  const steps: [number, string][] = [
    [1, "PICK A TRIP"],
    [2, "PAY"],
    [3, "CONFIRMED"],
  ];
  return (
    <>
      {(dockAddress || phone) && (
        <div
          className="bg-hull flex flex-wrap gap-3 justify-between font-plex-mono text-[12px] tracking-[.1em] text-ink-dark-3"
          style={{ padding: "9px 24px" }}
        >
          <span>{dockAddress ?? ""}</span>
          {phone && <span>QUESTIONS? {phone}</span>}
        </div>
      )}
      <div
        className="hull bg-hull flex flex-wrap gap-4 items-center justify-between"
        style={{ borderBottom: "3px solid #c94510", padding: "14px 24px" }}
      >
        <a
          href="/"
          className="text-[22px] font-bold tracking-[.05em] text-white uppercase font-archivo"
          style={{ textDecoration: "none" }}
        >
          {operatorName}
        </a>
        <ol className="flex gap-[4px] list-none m-0 p-0" aria-label="Booking steps">
          {steps.map(([n, label]) => {
            const active = n === step;
            return (
              <li
                key={n}
                aria-current={active ? "step" : undefined}
                className={`px-[14px] py-[10px] font-plex-mono text-[13px] font-semibold tracking-[.1em] ${
                  active ? "bg-orange text-white" : "text-ink-dark-3"
                }`}
              >
                {n} · {label}
              </li>
            );
          })}
        </ol>
      </div>
    </>
  );
}

// ─── FilterBar ────────────────────────────────────────────────────────────────

function FilterBar({
  filter,
  vessels,
  filteredTrips,
  onFilterChange,
}: {
  filter: string;
  vessels: VesselInfo[];
  filteredTrips: Trip[];
  onFilterChange: (f: string) => void;
}) {
  const dates = [...new Set(filteredTrips.map((t) => t.departureDate))].sort();
  const countLabel =
    filteredTrips.length === 0
      ? "NO TRIPS"
      : `${filteredTrips.length} TRIPS${
          dates.length > 0
            ? ` · ${fmtMonthDay(dates[0])} — ${fmtMonthDay(dates[dates.length - 1])}`
            : ""
        }`;

  const chipStyle = (active: boolean) =>
    `font-plex-mono text-[11px] font-semibold tracking-[.14em] cursor-pointer transition-colors flex items-center ${
      active ? "bg-orange text-white" : "bg-transparent text-white hover:border-white/50"
    }`;

  return (
    <div
      className="hull bg-hull-2 flex flex-wrap gap-[10px] items-center justify-between"
      style={{ padding: "10px 24px" }}
    >
      <div className="flex items-center flex-wrap gap-2">
        <span className="font-plex-mono text-[11px] font-semibold tracking-[.14em] text-ink-dark-3 mr-1">
          SHOW
        </span>
        {vessels.length > 1 ? (
          <div role="group" aria-label="Filter by boat" className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => onFilterChange("all")}
              aria-pressed={filter === "all"}
              className={chipStyle(filter === "all")}
              style={{
                border: `1px solid ${filter === "all" ? "#c94510" : "#3c5867"}`,
                padding: "0 16px",
                minHeight: 44,
              }}
            >
              ALL BOATS
            </button>
            {vessels.map((v) => (
              <button
                key={v.name}
                type="button"
                onClick={() => onFilterChange(v.name)}
                aria-pressed={filter === v.name}
                className={chipStyle(filter === v.name)}
                style={{
                  border: `1px solid ${filter === v.name ? "#c94510" : "#3c5867"}`,
                  padding: "0 16px",
                  minHeight: 44,
                }}
              >
                {v.name.toUpperCase()}
              </button>
            ))}
          </div>
        ) : (
          <span className="font-plex-mono text-[11px] font-semibold tracking-[.14em] text-white">
            ALL BOATS
          </span>
        )}
      </div>
      <span className="font-plex-mono text-[12px] tracking-[.1em]" style={{ color: "#8fa3ad" }}>
        {countLabel}
      </span>
    </div>
  );
}

// ─── InlineStepper ────────────────────────────────────────────────────────────

function InlineStepper({
  value,
  onDec,
  onInc,
  atMax,
  decLabel,
  incLabel,
}: {
  value: number;
  onDec: () => void;
  onInc: () => void;
  atMax: boolean;
  decLabel: string;
  incLabel: string;
}) {
  return (
    <div className="flex items-stretch flex-shrink-0" style={{ border: "1px solid #0d1c26" }}>
      <button
        type="button"
        onClick={onDec}
        disabled={value === 0}
        aria-label={decLabel}
        className="flex items-center justify-center bg-hull text-white text-[18px] font-semibold cursor-pointer disabled:opacity-40 hover:bg-hull-2 transition-colors border-none"
        style={{ width: 45, height: 46, borderRight: "1px solid #3c5867" }}
      >
        −
      </button>
      <span
        className="flex items-center justify-center font-plex-mono text-[15px] font-semibold"
        style={{ minWidth: 46, height: 46 }}
        aria-live="polite"
        aria-atomic="true"
      >
        {value}
      </span>
      <button
        type="button"
        onClick={onInc}
        disabled={atMax}
        aria-label={incLabel}
        className="flex items-center justify-center bg-hull text-white text-[18px] font-semibold cursor-pointer disabled:opacity-40 hover:bg-hull-2 transition-colors border-none"
        style={{ width: 45, height: 46, borderLeft: "1px solid #3c5867" }}
      >
        +
      </button>
    </div>
  );
}

// ─── TripRow ──────────────────────────────────────────────────────────────────

function TripRow({
  trip,
  getQty,
  onAdjustQty,
}: {
  trip: Trip;
  getQty: (tripId: string, ticketType: string) => number;
  onAdjustQty: (tripId: string, ticketType: string, delta: 1 | -1) => void;
}) {
  const soldOut = trip.seatsRemaining === 0;
  const displayPrices = getDisplayPrices(trip.product.prices);
  const totalQty = displayPrices.reduce((sum, p) => sum + getQty(trip.id, p.ticketType), 0);
  const inCart = totalQty > 0;

  const adultFare =
    trip.product.prices.find((p) => p.ticketType.toLowerCase() === "adult") ??
    trip.product.prices[0];

  const seatLabel = soldOut
    ? "SOLD OUT"
    : trip.seatsRemaining <= 10
    ? `${trip.seatsRemaining} SEATS LEFT`
    : "SEATS OPEN";
  const seatColor = soldOut ? "#41565f" : trip.seatsRemaining <= 10 ? "#8c3b12" : "#186a4a";

  return (
    <div
      className="booking-trip-row"
      style={{
        marginTop: 12,
        padding: "18px 20px",
        border: `1px solid ${inCart ? "#c94510" : "#dde4e6"}`,
        background: inCart ? "#ffffff" : "#f6f8f8",
        opacity: soldOut ? 0.55 : 1,
      }}
    >
      {/* Col 1: species kicker + name + meta */}
      <div className="trip-col-main min-w-0">
        <div
          className="font-plex-mono text-[11px] tracking-[.16em]"
          style={{ color: "#b1440f" }}
        >
          {trip.product.category.toUpperCase()}
        </div>
        <div className="font-archivo text-[19px] font-bold tracking-[-0.01em] mt-1">
          {trip.product.displayName}
        </div>
        <div className="font-plex-mono text-[13px] mt-[5px]" style={{ color: "#41565f" }}>
          {fmtTimeET(trip.startTime)} – {fmtTimeET(trip.endTime)} ·{" "}
          {fmtDuration(trip.startTime, trip.endTime)} · {trip.vessel.name}
        </div>
      </div>

      {/* Col 2: adult fare */}
      <div className="trip-col-fare font-plex-mono text-[20px] font-semibold self-center">
        {adultFare ? dollars(adultFare.priceCents) : "—"}
      </div>

      {/* Col 3: seat state */}
      <div
        className="trip-col-seats font-plex-mono text-[12px] font-semibold tracking-[.06em] self-center"
        style={{ color: seatColor }}
      >
        {seatLabel}
      </div>

      {/* Col 4: steppers or waitlist */}
      <div className="trip-col-action flex flex-col gap-[10px] justify-center">
        {soldOut ? (
          <button
            type="button"
            className="font-plex-mono text-[13px] font-semibold tracking-[.1em] cursor-pointer hover:bg-deck-3 transition-colors bg-transparent"
            style={{
              border: "1px solid #9aa8ae",
              padding: "11px 18px",
              color: "#41565f",
              minHeight: 44,
            }}
          >
            WAITLIST
          </button>
        ) : (
          displayPrices.map((price) => {
            const qty = getQty(trip.id, price.ticketType);
            const otherQty = displayPrices
              .filter((p) => p.ticketType !== price.ticketType)
              .reduce((sum, p) => sum + getQty(trip.id, p.ticketType), 0);
            const atMax = qty >= trip.seatsRemaining - otherQty;
            const label = price.displayLabel ?? price.ticketType;
            return (
              <div key={price.ticketType} className="flex items-center justify-between gap-3">
                <div>
                  <div className="font-archivo text-[15px] font-bold">
                    {label.charAt(0).toUpperCase() + label.slice(1)}
                  </div>
                  <div className="font-plex-mono text-[13px]" style={{ color: "#41565f" }}>
                    {dollars(price.priceCents)} each
                  </div>
                </div>
                <InlineStepper
                  value={qty}
                  onDec={() => onAdjustQty(trip.id, price.ticketType, -1)}
                  onInc={() => onAdjustQty(trip.id, price.ticketType, 1)}
                  atMax={atMax}
                  decLabel={`One fewer ${label} seat`}
                  incLabel={`One more ${label} seat`}
                />
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

// ─── DayGroup ─────────────────────────────────────────────────────────────────

function DayGroup({
  dateStr,
  trips,
  getQty,
  onAdjustQty,
  headerH,
}: {
  dateStr: string;
  trips: Trip[];
  getQty: (tripId: string, ticketType: string) => number;
  onAdjustQty: (tripId: string, ticketType: string, delta: 1 | -1) => void;
  headerH: number;
}) {
  const { main, sub } = fmtDayLabel(dateStr);
  const dayNum = parseInt(dateStr.slice(-2));
  return (
    <div id={`day-${dayNum}`} style={{ paddingTop: 26, scrollMarginTop: headerH + 16 }}>
      <div
        className="flex items-baseline gap-3 pb-2 bg-deck"
        style={{
          borderBottom: "2px solid #cdd6da",
          position: "sticky",
          top: headerH,
          zIndex: 2,
        }}
      >
        <span className="font-plex-mono text-[13px] font-semibold tracking-[.14em] uppercase">
          {main}
        </span>
        {sub && (
          <span
            className="font-plex-mono text-[12px] tracking-[.08em]"
            style={{ color: "#5b6f79" }}
          >
            {sub}
          </span>
        )}
      </div>
      {trips.map((trip) => (
        <TripRow key={trip.id} trip={trip} getQty={getQty} onAdjustQty={onAdjustQty} />
      ))}
    </div>
  );
}

// ─── RailCalendar ─────────────────────────────────────────────────────────────

function RailCalendar({
  month,
  byDate,
  selectedDay,
  cartDates,
  headerH,
  onDaySelect,
  onPrevMonth,
  onNextMonth,
}: {
  month: string;
  byDate: Record<string, Trip[]>;
  selectedDay: string | null;
  cartDates: Set<string>;
  headerH: number;
  onDaySelect: (date: string) => void;
  onPrevMonth: () => void;
  onNextMonth: () => void;
}) {
  const { year, mon } = parseMonth(month);
  const monthLabel = `${MONTHS[mon - 1].toUpperCase()} ${year}`;
  const firstDow = new Date(Date.UTC(year, mon - 1, 1)).getUTCDay();
  const lastDay = new Date(Date.UTC(year, mon, 0)).getUTCDate();
  const days = Array.from({ length: lastDay }, (_, i) =>
    `${month}-${String(i + 1).padStart(2, "0")}`
  );
  const cells: (string | null)[] = [...Array(firstDow).fill(null), ...days];
  while (cells.length % 7 !== 0) cells.push(null);

  return (
    <div
      className="bg-deck-2"
      style={{
        position: "sticky",
        top: headerH,
        zIndex: 3,
        borderBottom: "1px solid #cdd6da",
        padding: "16px 22px",
      }}
    >
      {/* Month navigation */}
      <div className="flex items-center justify-between mb-3">
        <button
          type="button"
          onClick={onPrevMonth}
          aria-label="Previous month"
          className="flex items-center justify-center bg-transparent text-hull cursor-pointer hover:text-hull-2 transition-colors border-none"
          style={{
            width: 44,
            height: 44,
            border: "1px solid #3c5867",
            fontSize: 20,
            lineHeight: 1,
          }}
        >
          ‹
        </button>
        <span className="font-plex-mono text-[13px] font-semibold tracking-[.1em] text-hull">
          {monthLabel}
        </span>
        <button
          type="button"
          onClick={onNextMonth}
          aria-label="Next month"
          className="flex items-center justify-center bg-transparent text-hull cursor-pointer hover:text-hull-2 transition-colors border-none"
          style={{
            width: 44,
            height: 44,
            border: "1px solid #3c5867",
            fontSize: 20,
            lineHeight: 1,
          }}
        >
          ›
        </button>
      </div>

      {/* Full grid — hidden at max-height: 720px */}
      <div className="booking-rail-cal-grid">
        {/* Weekday headers */}
        <div className="grid grid-cols-7 mb-1">
          {DAYS_SINGLE.map((d, i) => (
            <div
              key={i}
              className="font-plex-mono text-[10px] text-center"
              style={{ color: "#a7b3b8" }}
            >
              {d}
            </div>
          ))}
        </div>

        {/* Day cells */}
        <div className="grid grid-cols-7" style={{ gap: 4 }}>
          {cells.map((date, i) => {
            if (!date) return <div key={`empty-${i}`} style={{ height: 38 }} />;

            const hasSailings = (byDate[date]?.length ?? 0) > 0;
            const inCart = cartDates.has(date);
            const isSelected = date === selectedDay;
            const dayNum = parseInt(date.slice(-2));

            let bg = "transparent";
            let textColor = "#a7b3b8";
            let dotColor: string | null = null;
            let border = "none";

            if (hasSailings) {
              bg = isSelected ? "#c94510" : "#ffffff";
              textColor = isSelected ? "#ffffff" : "#0d1c26";
              dotColor = inCart ? "#c94510" : "#0d1c26";
              if (isSelected) dotColor = "#ffffff";
              border = isSelected ? "none" : "1px solid #cdd6da";
            }

            return (
              <button
                key={date}
                type="button"
                onClick={() => hasSailings && onDaySelect(date)}
                disabled={!hasSailings}
                aria-pressed={isSelected}
                aria-label={`${date}${hasSailings ? ", has sailings" : ", no sailings"}`}
                className="flex flex-col items-center justify-center transition-colors border-none"
                style={{
                  height: 38,
                  background: bg,
                  border,
                  cursor: hasSailings ? "pointer" : "default",
                  gap: 3,
                  fontFamily: "inherit",
                  padding: 0,
                }}
              >
                <span
                  className="font-plex-mono text-[12px]"
                  style={{ color: textColor, lineHeight: 1 }}
                >
                  {dayNum}
                </span>
                {dotColor && (
                  <span
                    style={{
                      display: "block",
                      width: 5,
                      height: 5,
                      borderRadius: "50%",
                      background: dotColor,
                      flexShrink: 0,
                    }}
                  />
                )}
              </button>
            );
          })}
        </div>

        {/* Legend */}
        <div className="flex items-center gap-4 mt-3">
          <span
            className="flex items-center gap-[6px] font-plex-mono text-[11px]"
            style={{ color: "#41565f" }}
          >
            <span
              style={{
                display: "inline-block",
                width: 6,
                height: 6,
                borderRadius: "50%",
                background: "#0d1c26",
              }}
            />
            SAILING
          </span>
          <span
            className="flex items-center gap-[6px] font-plex-mono text-[11px]"
            style={{ color: "#41565f" }}
          >
            <span
              style={{
                display: "inline-block",
                width: 6,
                height: 6,
                borderRadius: "50%",
                background: "#c94510",
              }}
            />
            IN YOUR CART
          </span>
        </div>
      </div>

      {/* Compact fallback — shown at max-height: 720px instead of grid */}
      <div className="booking-rail-cal-compact">
        <p className="font-plex-mono text-[12px] m-0" style={{ color: "#5b6f79" }}>
          Scroll the list to browse dates.
        </p>
      </div>
    </div>
  );
}

// ─── CartRail ─────────────────────────────────────────────────────────────────

function CartRail({
  cartItems,
  totalCents,
  totalSeats,
  holdSecs,
  month,
  byDate,
  selectedDay,
  cartDates,
  headerH,
  onRemove,
  onCheckout,
  onDaySelect,
  onPrevMonth,
  onNextMonth,
}: {
  cartItems: EnrichedCartItem[];
  totalCents: number;
  totalSeats: number;
  holdSecs: number | null;
  month: string;
  byDate: Record<string, Trip[]>;
  selectedDay: string | null;
  cartDates: Set<string>;
  headerH: number;
  onRemove: (tripId: string) => void;
  onCheckout: () => void;
  onDaySelect: (date: string) => void;
  onPrevMonth: () => void;
  onNextMonth: () => void;
}) {
  const hasSeats = totalSeats > 0;
  const isExpired = holdSecs !== null && holdSecs <= 0;
  const isWarning = holdSecs !== null && holdSecs > 0 && holdSecs < 120;

  return (
    <div
      className="booking-rail"
      style={{ borderLeft: "2px solid #cdd6da", background: "#e6eaea" }}
    >
      {/* Inner flex column — min-height: 100vh so total shelf is always at the bottom of the longest page */}
      <div
        style={{
          height: "100%",
          minHeight: "100vh",
          display: "flex",
          flexDirection: "column",
        }}
      >
        {/* 1. Month calendar — sticky at top */}
        <RailCalendar
          month={month}
          byDate={byDate}
          selectedDay={selectedDay}
          cartDates={cartDates}
          headerH={headerH}
          onDaySelect={onDaySelect}
          onPrevMonth={onPrevMonth}
          onNextMonth={onNextMonth}
        />

        {/* 2. Cart body — flex:1, scrolls with the page */}
        <div style={{ flex: 1, padding: "18px 22px 24px" }}>
          {/* YOUR SEATS header + hold countdown */}
          <div className="flex items-baseline justify-between gap-2 mb-3" style={{ flexWrap: "wrap" }}>
            <span
              className="font-plex-mono text-[12px] font-semibold tracking-[.16em]"
              style={{ color: "#0d1c26" }}
            >
              YOUR SEATS{totalSeats > 0 ? ` · ${totalSeats}` : ""}
            </span>
            {holdSecs !== null && (
              <span
                className="font-plex-mono text-[12px] font-semibold tracking-[.08em]"
                style={{ color: isWarning || isExpired ? "#8c3b12" : "#41565f" }}
              >
                {isExpired
                  ? "HOLD EXPIRED — SEATS RELEASED"
                  : `SEATS HELD ${fmtHoldTime(holdSecs)}`}
              </span>
            )}
          </div>

          {/* Empty state */}
          {cartItems.length === 0 ? (
            <div
              style={{
                border: "1px dashed #a9b6bc",
                background: "#eef1f0",
                padding: "18px 16px",
              }}
            >
              <div className="font-archivo text-[16px] font-bold">No seats yet.</div>
              <div
                className="font-archivo text-[14px] mt-1"
                style={{ lineHeight: 1.5, color: "#41565f" }}
              >
                Hit <strong>+</strong> on a ticket type. Nothing is charged until you pay.
              </div>
            </div>
          ) : (
            <ul
              style={{
                listStyle: "none",
                margin: 0,
                padding: 0,
                display: "flex",
                flexDirection: "column",
                gap: 8,
              }}
            >
              {cartItems.map((item) => {
                const subtotal = item.tickets.reduce(
                  (s, t) => s + t.quantity * t.priceCents,
                  0
                );
                const dateShort = new Date(
                  item.departureDate + "T12:00:00Z"
                ).toLocaleDateString("en-US", {
                  month: "short",
                  day: "numeric",
                  timeZone: "UTC",
                });
                return (
                  <li
                    key={`cart-${item.tripId}`}
                    style={{
                      background: "#ffffff",
                      border: "1px solid #cdd6da",
                      padding: "16px",
                    }}
                  >
                    <div className="flex items-baseline justify-between gap-2">
                      <div className="font-archivo text-[16px] font-bold">{item.productName}</div>
                      <div className="font-plex-mono text-[17px] font-semibold flex-shrink-0">
                        {dollars(subtotal)}
                      </div>
                    </div>
                    <div
                      className="font-plex-mono text-[12px] mt-[3px]"
                      style={{ color: "#41565f" }}
                    >
                      {dateShort} · {fmtTimeET(item.startTime)}
                    </div>
                    {item.tickets.map((t) => {
                      const lbl = t.displayLabel ?? t.ticketType;
                      return (
                        <div
                          key={t.ticketType}
                          className="font-plex-mono text-[12px] mt-[2px]"
                          style={{ color: "#41565f" }}
                        >
                          {t.quantity} × {lbl.charAt(0).toUpperCase() + lbl.slice(1)} ·{" "}
                          {dollars(t.priceCents)}
                        </div>
                      );
                    })}
                    <button
                      type="button"
                      onClick={() => onRemove(item.tripId)}
                      aria-label={`Remove ${item.productName} from cart`}
                      className="font-plex-mono text-[11px] font-semibold tracking-[.06em] cursor-pointer bg-transparent border-none mt-2 underline"
                      style={{
                        color: "#8c3b12",
                        padding: 0,
                        minHeight: 44,
                        display: "flex",
                        alignItems: "center",
                      }}
                    >
                      REMOVE
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {/* 3. Total shelf — sticky at bottom */}
        <div
          style={{
            position: "sticky",
            bottom: 0,
            zIndex: 3,
            borderTop: "2px solid #cdd6da",
            boxShadow: "0 -8px 16px rgba(13,28,38,.09)",
            background: "#e6eaea",
            padding: "14px 22px 18px",
          }}
        >
          <div className="flex items-baseline justify-between gap-2 mb-3">
            <span
              className="font-plex-mono text-[12px] font-semibold tracking-[.16em]"
              style={{ color: "#41565f" }}
            >
              TOTAL
            </span>
            <span
              className="font-plex-mono text-[30px] font-bold"
              style={{ lineHeight: 1, color: "#0d1c26" }}
            >
              {dollars(totalCents)}
            </span>
          </div>
          <button
            type="button"
            onClick={hasSeats ? onCheckout : undefined}
            aria-disabled={!hasSeats}
            className="w-full font-archivo text-[16px] font-bold tracking-[.08em] uppercase border-none text-white flex items-center justify-between gap-3"
            style={{
              background: hasSeats ? "#c94510" : "#b9c4c8",
              padding: "19px 20px",
              cursor: hasSeats ? "pointer" : "default",
            }}
          >
            <span>Check out</span>
            <span>{dollars(totalCents)} →</span>
          </button>
          <div
            className="font-plex-mono text-[11px] tracking-[.1em] mt-3 text-center"
            style={{ color: "#5b6f79" }}
          >
            FREE CANCELLATION · WEATHER REFUNDS · NO ACCOUNT NEEDED
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── MobileCartBar ────────────────────────────────────────────────────────────

function MobileCartBar({
  totalCents,
  totalSeats,
  onCheckout,
}: {
  totalCents: number;
  totalSeats: number;
  onCheckout: () => void;
}) {
  if (totalSeats === 0) return null;
  return (
    <div
      className="booking-mobile-bar hidden fixed inset-x-0 bottom-0 z-20 bg-hull items-center justify-between gap-[14px]"
      style={{ padding: "12px 18px" }}
    >
      <div>
        <div className="font-plex-mono text-[11px] tracking-[.14em] text-ink-dark-3">
          {totalSeats} {totalSeats === 1 ? "SEAT" : "SEATS"}
        </div>
        <div className="font-plex-mono text-[22px] font-bold text-white">{dollars(totalCents)}</div>
      </div>
      <button
        type="button"
        onClick={onCheckout}
        className="bg-orange text-white font-archivo text-[15px] font-bold tracking-[.08em] uppercase cursor-pointer hover:bg-orange-press transition-colors border-none"
        style={{ padding: "17px 24px" }}
      >
        Check out →
      </button>
    </div>
  );
}

// ─── EmptyState ───────────────────────────────────────────────────────────────

function EmptyState({ onNextMonth }: { onNextMonth: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center py-24 text-center">
      <div
        className="font-plex-mono text-[13px] font-semibold tracking-[.1em] mb-3"
        style={{ color: "#5b6f79" }}
      >
        NO TRIPS THIS MONTH
      </div>
      <button
        type="button"
        onClick={onNextMonth}
        className="font-plex-mono text-[13px] font-semibold underline hover:opacity-75 transition-opacity tracking-[.08em]"
        style={{ color: "#8c3b12" }}
      >
        SEE NEXT AVAILABLE MONTH →
      </button>
    </div>
  );
}

// ─── BookingCalendar (main) ───────────────────────────────────────────────────

export function BookingCalendar({
  initialTrips,
  initialMonth,
  operatorName,
  phone,
  dockAddress,
  termsUrl,
  initialDate,
  initialTripId,
}: {
  initialTrips: Trip[];
  initialMonth: string;
  operatorName: string;
  phone: string | null;
  dockAddress: string | null;
  termsUrl: string | null;
  initialDate?: string;
  initialTripId?: string;
}) {
  const [month, setMonth] = useState(initialMonth);
  const [trips, setTrips] = useState<Trip[]>(initialTrips);
  const [loading, setLoading] = useState(false);
  const [selectedDay, setSelectedDay] = useState<string | null>(initialDate ?? null);
  const [vesselFilter, setVesselFilter] = useState<string>("all");
  const [headerH, setHeaderH] = useState(0);

  const [cart, setCart] = useState<Map<string, number>>(new Map());
  const [cartPrices, setCartPrices] = useState<Map<string, number>>(new Map());
  const [cartItems, setCartItems] = useState<EnrichedCartItem[]>([]);

  // Seat hold timer
  const [holdExpiresAt, setHoldExpiresAt] = useState<number | null>(null);
  const [holdSecs, setHoldSecs] = useState<number | null>(null);
  const holdStartedRef = useRef(false);
  const cartRestoredRef = useRef(false);

  const announceRef = useRef<HTMLDivElement>(null);
  const headerRef = useRef<HTMLDivElement>(null);

  // Measure sticky header height
  useEffect(() => {
    const el = headerRef.current;
    if (!el) return;
    const measure = () => setHeaderH(el.offsetHeight);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Restore cart + hold from localStorage on mount
  useEffect(() => {
    let restoredItems: EnrichedCartItem[] = [];
    try {
      const raw = localStorage.getItem("openboat_cart");
      if (raw) {
        const parsed: EnrichedCartItem[] = JSON.parse(raw);
        const seen = new Set<string>();
        restoredItems = parsed.filter((item) => {
          if (seen.has(item.tripId)) return false;
          seen.add(item.tripId);
          return true;
        });
        const map = new Map<string, number>();
        const prices = new Map<string, number>();
        restoredItems.forEach((item) => {
          item.tickets.forEach((t) => {
            map.set(`${item.tripId}:${t.ticketType}`, t.quantity);
            prices.set(`${item.tripId}:${t.ticketType}`, t.priceCents);
          });
        });
        if (map.size > 0) setCart(map);
        if (prices.size > 0) setCartPrices(prices);
        if (restoredItems.length > 0) setCartItems(restoredItems);
      }
    } catch { /* ignore corrupt data */ }

    // Restore hold timer if still valid and cart is non-empty
    if (restoredItems.length > 0) {
      try {
        const storedHold = localStorage.getItem("openboat_hold_expires");
        if (storedHold) {
          const expiresAt = parseInt(storedHold);
          if (expiresAt > Date.now()) {
            setHoldExpiresAt(expiresAt);
            holdStartedRef.current = true;
          } else {
            localStorage.removeItem("openboat_hold_expires");
          }
        }
      } catch { /* ignore */ }
    }

    cartRestoredRef.current = true;

    // Pre-add 1 adult ticket when navigating from homepage BOOK button
    if (initialTripId && !restoredItems.some((i) => i.tripId === initialTripId)) {
      const trip = initialTrips.find((t) => t.id === initialTripId);
      if (trip) {
        const adultPrice =
          trip.product.prices.find((p) => p.ticketType.toLowerCase() === "adult") ??
          trip.product.prices[0];
        if (adultPrice && trip.seatsRemaining > 0) {
          const k = `${trip.id}:${adultPrice.ticketType}`;
          setCart((prev) => new Map(prev).set(k, 1));
          setCartPrices((prev) => new Map(prev).set(k, adultPrice.priceCents));
          setCartItems((prev) => [
            ...prev,
            {
              tripId: trip.id,
              departureDate: trip.departureDate,
              startTime: trip.startTime,
              endTime: trip.endTime,
              vesselName: trip.vessel.name,
              vesselColor: trip.vessel.color,
              category: trip.product.category,
              productName: trip.product.displayName,
              seatsRemaining: trip.seatsRemaining,
              tickets: [
                {
                  ticketType: adultPrice.ticketType,
                  quantity: 1,
                  priceCents: adultPrice.priceCents,
                },
              ],
            },
          ]);
          setSelectedDay(trip.departureDate);
          // Start hold for this initial seat
          if (!holdStartedRef.current) {
            const expiresAt = Date.now() + 10 * 60 * 1000;
            holdStartedRef.current = true;
            setHoldExpiresAt(expiresAt);
            try {
              localStorage.setItem("openboat_hold_expires", String(expiresAt));
            } catch { /* ignore */ }
          }
        }
      }
    }
  }, []); // intentional: run once on mount only

  // Persist cart to localStorage
  useEffect(() => {
    if (cartItems.length === 0) {
      localStorage.removeItem("openboat_cart");
    } else {
      localStorage.setItem("openboat_cart", JSON.stringify(cartItems));
    }
  }, [cartItems]);

  // Hold timer tick
  useEffect(() => {
    if (holdExpiresAt === null) return;
    const tick = () =>
      setHoldSecs(Math.max(0, Math.round((holdExpiresAt - Date.now()) / 1000)));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [holdExpiresAt]);

  useEffect(() => {
    posthog.capture("booking_view");
  }, []);

  const { year, mon } = parseMonth(month);

  async function goToMonth(m: string) {
    setLoading(true);
    const data = await fetch(`/api/trips?month=${m}`).then((r) => r.json());
    setTrips(data);
    setMonth(m);
    setSelectedDay(null);
    setLoading(false);
  }
  function prevMonth() {
    const d = new Date(Date.UTC(year, mon - 2, 1));
    goToMonth(toMonthStr(d.getUTCFullYear(), d.getUTCMonth() + 1));
  }
  function nextMonth() {
    const d = new Date(Date.UTC(year, mon, 1));
    goToMonth(toMonthStr(d.getUTCFullYear(), d.getUTCMonth() + 1));
  }

  function getQty(tripId: string, ticketType: string) {
    return cart.get(`${tripId}:${ticketType}`) ?? 0;
  }

  const adjustQty = useCallback(
    (tripId: string, ticketType: string, delta: 1 | -1) => {
      const trip = trips.find((t) => t.id === tripId);
      if (!trip) return;

      const k = `${tripId}:${ticketType}`;
      const price = trip.product.prices.find((p) => p.ticketType === ticketType);

      if (price) {
        setCartPrices((prev) => new Map(prev).set(k, price.priceCents));
      }

      setCart((prev) => {
        const next = new Map(prev);
        const otherQty = trip.product.prices
          .filter((p) => p.ticketType !== ticketType)
          .reduce((sum, p) => sum + (next.get(`${tripId}:${p.ticketType}`) ?? 0), 0);
        const maxForType = trip.seatsRemaining - otherQty;
        const currentQty = next.get(k) ?? 0;
        const newQty = Math.max(0, Math.min(maxForType, currentQty + delta));
        if (newQty === 0) next.delete(k);
        else next.set(k, newQty);
        return next;
      });

      const displayPrices = getDisplayPrices(trip.product.prices);
      const isCollapsed =
        displayPrices.length === 1 && displayPrices[0].displayLabel === "seat";
      const displayLabel = isCollapsed ? "seat" : ticketType;

      setCartItems((prev) => {
        const existing = prev.find((i) => i.tripId === tripId);
        const without = prev.filter((i) => i.tripId !== tripId);
        const existingQty =
          existing?.tickets.find((t) => t.ticketType === ticketType)?.quantity ?? 0;
        const otherTickets =
          existing?.tickets.filter((t) => t.ticketType !== ticketType) ?? [];
        const otherQty = otherTickets.reduce((s, t) => s + t.quantity, 0);
        const maxForType = trip.seatsRemaining - otherQty;
        const newQty = Math.max(0, Math.min(maxForType, existingQty + delta));
        const newTickets = otherTickets.filter((t) => t.quantity > 0).map((t) => ({
          ...t,
          displayLabel: isCollapsed ? "seat" : t.ticketType,
        }));
        if (newQty > 0 && price) {
          newTickets.push({ ticketType, quantity: newQty, priceCents: price.priceCents, displayLabel });
        }
        if (newTickets.length === 0) return without;
        return [
          ...without,
          {
            tripId: trip.id,
            departureDate: trip.departureDate,
            startTime: trip.startTime,
            endTime: trip.endTime,
            vesselName: trip.vessel.name,
            vesselColor: trip.vessel.color,
            category: trip.product.category,
            productName: trip.product.displayName,
            seatsRemaining: trip.seatsRemaining,
            tickets: newTickets,
          },
        ];
      });

      // Start hold timer on first seat added
      if (delta === 1 && cartRestoredRef.current && !holdStartedRef.current) {
        const expiresAt = Date.now() + 10 * 60 * 1000;
        holdStartedRef.current = true;
        setHoldExpiresAt(expiresAt);
        try {
          localStorage.setItem("openboat_hold_expires", String(expiresAt));
        } catch { /* ignore */ }
      }
    },
    [trips]
  );

  function removeFromCart(tripId: string) {
    const item = cartItems.find((i) => i.tripId === tripId);
    const trip = trips.find((t) => t.id === tripId);
    const keys = trip
      ? trip.product.prices.map((p) => `${tripId}:${p.ticketType}`)
      : Array.from(cart.keys()).filter((k) => k.startsWith(`${tripId}:`));
    setCart((prev) => {
      const next = new Map(prev);
      keys.forEach((k) => next.delete(k));
      return next;
    });
    const newItems = cartItems.filter((i) => i.tripId !== tripId);
    setCartItems(newItems);
    if (announceRef.current) {
      announceRef.current.textContent = `${item?.productName ?? "Trip"} removed`;
    }
    // Clear hold when cart becomes empty
    if (newItems.length === 0) {
      setHoldExpiresAt(null);
      setHoldSecs(null);
      holdStartedRef.current = false;
      try { localStorage.removeItem("openboat_hold_expires"); } catch { /* ignore */ }
    }
  }

  const totalCents = Array.from(cart.entries()).reduce(
    (sum, [key, qty]) => sum + qty * (cartPrices.get(key) ?? 0),
    0
  );
  const totalSeats = Array.from(cart.values()).reduce((a, b) => a + b, 0);

  function handleDaySelect(date: string) {
    setSelectedDay(date);
    const dayNum = parseInt(date.slice(-2));
    const el = document.getElementById(`day-${dayNum}`);
    if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function goToCheckout() {
    window.location.href = "/checkout";
  }

  // Unique vessels from current month's trips
  const vessels = Array.from(
    trips
      .reduce((map, t) => {
        if (!map.has(t.vessel.name)) map.set(t.vessel.name, t.vessel);
        return map;
      }, new Map<string, VesselInfo>())
      .values()
  );

  const filteredTrips =
    vesselFilter === "all" ? trips : trips.filter((t) => t.vessel.name === vesselFilter);

  const byDate = filteredTrips.reduce<Record<string, Trip[]>>((acc, t) => {
    (acc[t.departureDate] ??= []).push(t);
    return acc;
  }, {});
  const dates = Object.keys(byDate).sort();
  const cartDates = new Set(cartItems.map((i) => i.departureDate));

  return (
    <div
      className="bg-deck font-archivo"
      style={{
        maxWidth: 1440,
        margin: "0 auto",
        borderLeft: "2px solid #cdd6da",
        borderRight: "2px solid #cdd6da",
        minHeight: "100vh",
      }}
    >
      <div
        ref={announceRef}
        aria-live="polite"
        aria-atomic="true"
        style={{
          position: "absolute",
          width: 1,
          height: 1,
          overflow: "hidden",
          clip: "rect(0 0 0 0)",
          whiteSpace: "nowrap",
        }}
      />

      <div ref={headerRef} style={{ position: "sticky", top: 0, zIndex: 50 }}>
        <BookingNav
          operatorName={operatorName}
          dockAddress={dockAddress}
          phone={phone}
          step={1}
        />
        <FilterBar
          filter={vesselFilter}
          vessels={vessels}
          filteredTrips={filteredTrips}
          onFilterChange={setVesselFilter}
        />
      </div>

      <div className="booking-shell">
        {/* Left: trip list */}
        <div
          className={`booking-list-col transition-opacity ${
            loading ? "opacity-40 pointer-events-none" : ""
          }`}
          aria-busy={loading}
          style={{ padding: "8px 24px 120px" }}
        >
          {dates.length === 0 ? (
            <EmptyState onNextMonth={nextMonth} />
          ) : (
            dates.map((date) => (
              <DayGroup
                key={date}
                dateStr={date}
                trips={byDate[date] ?? []}
                getQty={getQty}
                onAdjustQty={adjustQty}
                headerH={headerH}
              />
            ))
          )}
        </div>

        {/* Right: cart rail */}
        <CartRail
          cartItems={cartItems}
          totalCents={totalCents}
          totalSeats={totalSeats}
          holdSecs={holdSecs}
          month={month}
          byDate={byDate}
          selectedDay={selectedDay}
          cartDates={cartDates}
          headerH={headerH}
          onRemove={removeFromCart}
          onCheckout={goToCheckout}
          onDaySelect={handleDaySelect}
          onPrevMonth={prevMonth}
          onNextMonth={nextMonth}
        />
      </div>

      <MobileCartBar
        totalCents={totalCents}
        totalSeats={totalSeats}
        onCheckout={goToCheckout}
      />

      {/* Footer */}
      <div
        className="hull bg-hull font-plex-mono text-[13px] tracking-[.04em]"
        style={{
          padding: "16px 24px",
          color: "#c9d2d8",
          borderTop: "2px solid #201e1d",
          display: "flex",
          flexWrap: "wrap",
          gap: "8px 28px",
          justifyContent: "space-between",
        }}
      >
        <span>FREE CANCELLATION TO 24H · RODS &amp; BAIT ABOARD · WEATHER REFUNDS AUTOMATIC</span>
        <a href="/" style={{ color: "#ffffff", textDecoration: "none" }}>
          ← BACK TO HOME
        </a>
      </div>
    </div>
  );
}
