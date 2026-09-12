"use client";

import { useState, useEffect, useRef } from "react";
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
  vessel: { name: string; color: string };
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
  }[];
};

type ViewMode = "list" | "calendar";
type VesselInfo = { name: string; color: string };

// ─── Helpers ──────────────────────────────────────────────────────────────────

const MONTHS = [
  "January","February","March","April","May","June",
  "July","August","September","October","November","December",
];
const DAYS_SHORT = ["SUN","MON","TUE","WED","THU","FRI","SAT"];

function toMonthStr(year: number, mon: number) {
  return `${year}-${String(mon).padStart(2,"0")}`;
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

// ─── Booking nav (utility strip + brand bar + step chips) ─────────────────────

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
      {/* Utility strip */}
      {(dockAddress || phone) && (
        <div className="bg-hull px-6 flex flex-wrap gap-3 justify-between font-plex-mono text-[12px] tracking-[.1em] text-ink-dark-3" style={{ padding: "9px 24px" }}>
          <span>{dockAddress ?? ""}</span>
          {phone && <span>QUESTIONS? {phone}</span>}
        </div>
      )}
      {/* Brand + step nav */}
      <div className="bg-hull px-6 flex flex-wrap gap-4 items-center justify-between" style={{ borderBottom: "3px solid #d1541f", padding: "14px 24px" }}>
        <a
          href="/"
          className="text-[22px] font-bold tracking-[.05em] text-white uppercase font-archivo"
          style={{ textDecoration: "none" }}
        >
          {operatorName}
        </a>
        <div className="flex gap-[6px] font-plex-mono text-[11px]">
          {steps.map(([n, label]) => {
            const active = n === step;
            return (
              <div
                key={n}
                className={`px-[14px] py-[10px] font-semibold tracking-[.14em] ${active ? "bg-orange text-white" : "text-ink-dark-3"}`}
              >
                {n} · {label}
              </div>
            );
          })}
        </div>
      </div>
    </>
  );
}

// ─── Filter bar ───────────────────────────────────────────────────────────────

function FilterBar({
  month,
  view,
  filter,
  vessels,
  onPrevMonth,
  onNextMonth,
  onViewChange,
  onFilterChange,
}: {
  month: string;
  view: ViewMode;
  filter: string;
  vessels: VesselInfo[];
  onPrevMonth: () => void;
  onNextMonth: () => void;
  onViewChange: (v: ViewMode) => void;
  onFilterChange: (f: string) => void;
}) {
  const { year, mon } = parseMonth(month);
  const monthLabel = `${MONTHS[mon - 1].toUpperCase()} ${year}`;
  const viewChipStyle = (active: boolean) =>
    `px-[18px] py-[11px] font-plex-mono text-[11px] font-semibold tracking-[.14em] cursor-pointer border transition-colors ${
      active
        ? "bg-white text-hull border-white"
        : "bg-transparent text-ink-dark-2 border-hull-line hover:text-white"
    }`;
  const filterChipStyle = (active: boolean) =>
    `px-[16px] py-[11px] font-plex-mono text-[11px] font-semibold tracking-[.14em] cursor-pointer border transition-colors ${
      active
        ? "bg-orange border-orange text-white"
        : "bg-transparent border-hull-line text-white hover:border-white/50"
    }`;

  const showVesselFilter = vessels.length > 1;

  return (
    <div className="bg-hull-2 flex flex-wrap gap-[14px] items-center justify-between" style={{ padding: "14px 24px" }}>
      {/* Month stepper */}
      <div className="flex items-center gap-[10px]">
        <button
          type="button"
          onClick={onPrevMonth}
          aria-label="Previous month"
          className="flex items-center justify-center bg-transparent text-[#dfe8ec] cursor-pointer hover:text-white transition-colors"
          style={{ width: 34, height: 34, border: "1px solid #3c5867", fontSize: 16 }}
        >
          ‹
        </button>
        <span className="font-plex-mono text-[14px] tracking-[.1em] text-white text-center" style={{ minWidth: 170 }}>
          {monthLabel}
        </span>
        <button
          type="button"
          onClick={onNextMonth}
          aria-label="Next month"
          className="flex items-center justify-center bg-transparent text-[#dfe8ec] cursor-pointer hover:text-white transition-colors"
          style={{ width: 34, height: 34, border: "1px solid #3c5867", fontSize: 16 }}
        >
          ›
        </button>
      </div>

      <div className="flex flex-wrap gap-[18px] items-center">
        {/* View toggle */}
        <div className="flex">
          <button type="button" onClick={() => onViewChange("list")} className={viewChipStyle(view === "list")}>LIST</button>
          <button type="button" onClick={() => onViewChange("calendar")} className={viewChipStyle(view === "calendar")}>CALENDAR</button>
        </div>
        {/* Vessel filter — hidden when only 1 vessel */}
        {showVesselFilter && (
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => onFilterChange("all")} className={filterChipStyle(filter === "all")}>
              ALL
            </button>
            {vessels.map((v) => (
              <button
                key={v.name}
                type="button"
                onClick={() => onFilterChange(v.name)}
                className={filterChipStyle(filter === v.name)}
              >
                <span
                  className="inline-block rounded-full mr-[6px]"
                  style={{ width: 7, height: 7, background: filter === v.name ? "#fff" : v.color, verticalAlign: "middle" }}
                />
                {v.name.toUpperCase()}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Inline stepper ────────────────────────────────────────────────────────────

function InlineStepper({
  value,
  onDec,
  onInc,
  max,
  label,
}: {
  value: number;
  onDec: () => void;
  onInc: () => void;
  max: number;
  label?: string;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      {label && (
        <div className="font-plex-mono text-[10px] font-semibold tracking-[.12em] text-ink-dark-3 flex-shrink-0">
          {label}
        </div>
      )}
      <div className="flex items-stretch flex-shrink-0" style={{ border: "1px solid #0d1c26", height: 34 }}>
        <button
          type="button"
          onClick={onDec}
          disabled={value === 0}
          aria-label="One fewer seat"
          className="flex items-center justify-center bg-white text-hull text-[18px] font-semibold cursor-pointer disabled:opacity-40 hover:bg-deck-3 transition-colors border-none"
          style={{ width: 34, borderRight: "1px solid #0d1c26" }}
        >
          −
        </button>
        <span
          className="flex items-center justify-center font-plex-mono text-[15px] font-semibold"
          style={{ width: 40 }}
          aria-live="polite"
          aria-atomic="true"
        >
          {value}
        </span>
        <button
          type="button"
          onClick={onInc}
          disabled={value >= max}
          aria-label="One more seat"
          className="flex items-center justify-center bg-hull text-white text-[18px] font-semibold cursor-pointer disabled:opacity-40 hover:bg-hull-2 transition-colors border-none"
          style={{ width: 34, borderLeft: "1px solid #0d1c26" }}
        >
          +
        </button>
      </div>
    </div>
  );
}

// ─── Trip Row ─────────────────────────────────────────────────────────────────

function TripRow({
  trip,
  getQty,
  onSetQty,
}: {
  trip: Trip;
  getQty: (tripId: string, ticketType: string) => number;
  onSetQty: (tripId: string, ticketType: string, qty: number) => void;
}) {
  const soldOut = trip.seatsRemaining === 0;
  const activePrices = trip.product.prices.filter((p) => p.priceCents > 0);
  const totalQty = activePrices.reduce((sum, p) => sum + getQty(trip.id, p.ticketType), 0);
  const inCart = totalQty > 0;

  const seatLabel =
    soldOut
      ? "SOLD OUT"
      : trip.seatsRemaining <= 10
      ? `${trip.seatsRemaining} SEATS LEFT`
      : `${trip.seatsRemaining} OPEN`;
  const seatColorClass = soldOut
    ? "text-[#9aa8ae]"
    : trip.seatsRemaining <= 10
    ? "text-orange-press"
    : "text-green-open";

  return (
    <div
      className={`booking-trip-row px-5 mt-3 transition-colors ${
        inCart ? "bg-white" : "bg-deck-3"
      } ${soldOut ? "opacity-[.55]" : ""}`}
      style={{
        padding: "18px 20px",
        border: `1px solid ${inCart ? "#d1541f" : "#dde4e6"}`,
      }}
    >
      {/* Col 1: trip info */}
      <div className="trip-col-main min-w-0">
        <div className="font-plex-mono text-[11px] tracking-[.16em] text-orange-ink">
          {trip.product.category.toUpperCase()}
        </div>
        <div className="text-[19px] font-bold tracking-[-0.01em] mt-1 font-archivo">
          {trip.product.displayName}
        </div>
        <div className="font-plex-mono text-[13px] text-ink-2 mt-[5px]">
          {fmtTimeET(trip.startTime)} – {fmtTimeET(trip.endTime)} · {fmtDuration(trip.startTime, trip.endTime)} · {trip.vessel.name}
        </div>
      </div>

      {/* Col 2: seat state */}
      <div className={`trip-col-seats font-plex-mono text-[12px] font-semibold tracking-[.06em] self-center ${seatColorClass}`}>
        {seatLabel}
      </div>

      {/* Col 4: stepper or waitlist */}
      <div className="trip-col-action flex flex-col gap-2 justify-center">
        {soldOut ? (
          <button
            type="button"
            className="font-plex-mono text-[12px] font-semibold tracking-[.1em] cursor-pointer hover:bg-deck-3 transition-colors bg-transparent text-ink-2"
            style={{ border: "1px solid #9aa8ae", padding: "13px 18px" }}
          >
            WAITLIST
          </button>
        ) : (
          activePrices.map((price) => {
            const qty = getQty(trip.id, price.ticketType);
            const otherQty = activePrices
              .filter((p) => p.ticketType !== price.ticketType)
              .reduce((sum, p) => sum + getQty(trip.id, p.ticketType), 0);
            const maxForType = trip.seatsRemaining - otherQty;
            return (
              <InlineStepper
                key={price.ticketType}
                value={qty}
                onDec={() => onSetQty(trip.id, price.ticketType, Math.max(0, qty - 1))}
                onInc={() => onSetQty(trip.id, price.ticketType, Math.min(maxForType, qty + 1))}
                max={maxForType}
                label={`${price.ticketType.toUpperCase()} · ${dollars(price.priceCents)}`}
              />
            );
          })
        )}
      </div>
    </div>
  );
}

// ─── Day Group ────────────────────────────────────────────────────────────────

function DayGroup({
  dateStr,
  trips,
  getQty,
  onSetQty,
}: {
  dateStr: string;
  trips: Trip[];
  getQty: (tripId: string, ticketType: string) => number;
  onSetQty: (tripId: string, ticketType: string, qty: number) => void;
}) {
  const { main, sub } = fmtDayLabel(dateStr);
  return (
    <div style={{ paddingTop: 26 }}>
      <div className="flex items-baseline gap-3 pb-2" style={{ borderBottom: "2px solid #cdd6da" }}>
        <span className="font-plex-mono text-[13px] font-semibold tracking-[.14em] uppercase">
          {main}
        </span>
        {sub && (
          <span className="font-plex-mono text-[12px] text-ink-3 tracking-[.08em]">{sub}</span>
        )}
      </div>
      {trips.map((trip) => (
        <TripRow key={trip.id} trip={trip} getQty={getQty} onSetQty={onSetQty} />
      ))}
    </div>
  );
}

// ─── Cart Rail ────────────────────────────────────────────────────────────────

function CartRail({
  cartItems,
  totalCents,
  totalSeats,
  selectedDay,
  dayTrips,
  getQty,
  onSetQty,
  onRemove,
  onCheckout,
}: {
  cartItems: EnrichedCartItem[];
  totalCents: number;
  totalSeats: number;
  selectedDay: string | null;
  dayTrips: Trip[];
  getQty: (tripId: string, ticketType: string) => number;
  onSetQty: (tripId: string, ticketType: string, qty: number) => void;
  onRemove: (tripId: string) => void;
  onCheckout: () => void;
}) {
  const outerRef = useRef<HTMLDivElement>(null);
  const [railHeight, setRailHeight] = useState("100vh");

  // Measure distance from viewport top on mount so the rail never overflows the
  // bottom of the screen when the nav + filter bar are still above it.
  useEffect(() => {
    const el = outerRef.current;
    if (!el) return;
    const top = el.getBoundingClientRect().top;
    if (top > 0) setRailHeight(`calc(100vh - ${Math.round(top)}px)`);
  }, []);

  const showPickSeats = selectedDay && dayTrips.length > 0;

  return (
    <div
      ref={outerRef}
      className="booking-rail"
      style={{
        borderLeft: "2px solid #cdd6da",
        background: "#e6eaea",
        position: "sticky",
        top: 0,
        height: railHeight,
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
      }}
    >
      {/* ── Scrollable content ── */}
      <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "22px 22px 8px" }}>

        {/* PICK YOUR SEATS */}
        {showPickSeats && (
          <div style={{ marginBottom: 20 }}>
            <div
              className="font-plex-mono text-[11px] font-semibold tracking-[.16em] text-ink-2 uppercase mb-3"
            >
              {fmtDayLabel(selectedDay).main}
            </div>
            {dayTrips.map((trip) => {
              const activePrices = trip.product.prices.filter((p) => p.priceCents > 0);
              const soldOut = trip.seatsRemaining === 0;
              const totalQty = activePrices.reduce((s, p) => s + getQty(trip.id, p.ticketType), 0);
              const inCart = totalQty > 0;
              return (
                <div
                  key={`pick-${trip.id}`}
                  style={{
                    background: "#fff",
                    border: `1px solid ${inCart ? "#d1541f" : "#cdd6da"}`,
                    padding: "14px 16px",
                    marginBottom: 8,
                    opacity: soldOut ? 0.55 : 1,
                  }}
                >
                  <div className="font-plex-mono text-[10px] tracking-[.16em] text-orange-ink mb-[3px]">
                    {trip.product.category.toUpperCase()}
                  </div>
                  <div className="flex items-baseline justify-between gap-2 mb-1">
                    <div className="font-archivo text-[16px] font-bold leading-tight">{trip.product.displayName}</div>
                    {!soldOut && (
                      <div className={`font-plex-mono text-[11px] font-semibold flex-shrink-0 ${trip.seatsRemaining <= 10 ? "text-orange-press" : "text-green-open"}`}>
                        {trip.seatsRemaining <= 10 ? `${trip.seatsRemaining} LEFT` : `${trip.seatsRemaining} OPEN`}
                      </div>
                    )}
                  </div>
                  <div className="font-plex-mono text-[11px] text-ink-2 mb-3">
                    {fmtTimeET(trip.startTime)} – {fmtTimeET(trip.endTime)} · {trip.vessel.name}
                  </div>
                  {soldOut ? (
                    <div className="font-plex-mono text-[11px] text-[#9aa8ae]">SOLD OUT</div>
                  ) : (
                    <div className="flex flex-col gap-2">
                      {activePrices.map((price) => {
                        const qty = getQty(trip.id, price.ticketType);
                        const otherQty = activePrices
                          .filter((p) => p.ticketType !== price.ticketType)
                          .reduce((s, p) => s + getQty(trip.id, p.ticketType), 0);
                        return (
                          <InlineStepper
                            key={price.ticketType}
                            value={qty}
                            onDec={() => onSetQty(trip.id, price.ticketType, Math.max(0, qty - 1))}
                            onInc={() => onSetQty(trip.id, price.ticketType, Math.min(trip.seatsRemaining - otherQty, qty + 1))}
                            max={trip.seatsRemaining - otherQty}
                            label={`${price.ticketType.toUpperCase()} · ${dollars(price.priceCents)}`}
                          />
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* YOUR SEATS */}
        <div className="font-plex-mono text-[12px] tracking-[.16em] text-ink-2 mb-2">YOUR SEATS</div>

        {cartItems.length === 0 ? (
          <div style={{ border: "1px dashed #a9b6bc", padding: "18px 16px", background: "#eef1f0" }}>
            <div className="text-[15px] font-bold font-archivo">No seats yet.</div>
            <div className="text-[13px] text-ink-2 mt-1" style={{ lineHeight: 1.5 }}>
              Select a day, then hit <strong>+</strong> on a trip.
            </div>
          </div>
        ) : (
          <div>
            {cartItems.map((item) => {
              const subtotal = item.tickets.reduce((s, t) => s + t.quantity * t.priceCents, 0);
              const seatsLabel = item.tickets.map((t) => `${t.quantity} ${t.ticketType}`).join(" · ");
              const dateShort = new Date(item.departureDate + "T12:00:00Z").toLocaleDateString("en-US", {
                month: "short", day: "numeric", timeZone: "UTC",
              });
              return (
                <div
                  key={`cart-${item.tripId}`}
                  className="flex items-start justify-between gap-2"
                  style={{ borderBottom: "1px solid #cdd6da", padding: "10px 0" }}
                >
                  <div className="min-w-0">
                    <div className="font-archivo text-[13px] font-bold truncate">{item.productName}</div>
                    <div className="font-plex-mono text-[11px] text-ink-2 mt-[2px]">
                      {dateShort} · {fmtTimeET(item.startTime)}
                    </div>
                    <div className="font-plex-mono text-[11px] text-ink-2">{seatsLabel}</div>
                    <button
                      type="button"
                      onClick={() => onRemove(item.tripId)}
                      className="font-plex-mono text-[10px] tracking-[.1em] text-orange-press cursor-pointer bg-transparent border-none mt-[3px] underline hover:text-orange-ink p-0"
                    >
                      REMOVE
                    </button>
                  </div>
                  <div className="font-plex-mono text-[14px] font-semibold flex-shrink-0">
                    {dollars(subtotal)}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ── Sticky checkout ── */}
      {cartItems.length > 0 && (
        <div
          style={{
            flexShrink: 0,
            padding: "16px 22px 20px",
            borderTop: "2px solid #cdd6da",
            background: "#e6eaea",
          }}
        >
          <div className="flex justify-between items-baseline mb-3">
            <span className="font-plex-mono text-[12px] tracking-[.16em] text-ink-2">TOTAL</span>
            <span className="font-plex-mono text-[30px] font-bold">{dollars(totalCents)}</span>
          </div>
          <button
            type="button"
            onClick={onCheckout}
            className="w-full bg-orange text-white font-archivo text-[16px] font-bold tracking-[.08em] uppercase cursor-pointer hover:bg-orange-press transition-colors border-none"
            style={{ padding: "19px 20px" }}
          >
            Check out · {dollars(totalCents)} →
          </button>
          <div className="font-plex-mono text-[11px] text-ink-2 mt-3 tracking-[.04em]" style={{ lineHeight: 1.7 }}>
            FREE CANCELLATION TO 24H<br />
            WEATHER REFUNDS AUTOMATIC<br />
            NO ACCOUNT NEEDED
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Mobile cart bar ──────────────────────────────────────────────────────────

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

// ─── Calendar grid (kept from original, restyled with new tokens) ─────────────

function MonthGrid({
  month,
  byDate,
  selectedDay,
  onDaySelect,
  totalQtyForTrip,
}: {
  month: string;
  byDate: Record<string, Trip[]>;
  selectedDay: string | null;
  onDaySelect: (d: string) => void;
  totalQtyForTrip: (id: string) => number;
}) {
  const { year, mon } = parseMonth(month);
  const firstDow = new Date(Date.UTC(year, mon - 1, 1)).getUTCDay();
  const lastDay = new Date(Date.UTC(year, mon, 0)).getUTCDate();
  const today = new Date().toISOString().slice(0, 10);
  const days = Array.from({ length: lastDay }, (_, i) => `${month}-${String(i + 1).padStart(2,"0")}`);
  const cells: (string | null)[] = [...Array(firstDow).fill(null), ...days];
  while (cells.length % 7 !== 0) cells.push(null);

  return (
    <div>
      <div className="grid grid-cols-7 mb-2">
        {DAYS_SHORT.map((d) => (
          <div key={d} className="font-plex-mono text-[11px] font-semibold tracking-[.14em] text-ink-3 pb-2">{d}</div>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-[6px]">
        {cells.map((date, i) => {
          if (!date) return <div key={i} style={{ background: "#e9eded", border: "1px solid #dde4e6", minHeight: 112 }} />;
          const dayTrips = byDate[date] ?? [];
          const isSelected = date === selectedDay;
          const isToday = date === today;
          const hasTrips = dayTrips.length > 0;
          const inCart = dayTrips.some((t) => totalQtyForTrip(t.id) > 0);
          const dayNum = parseInt(date.slice(-2));
          return (
            <button
              key={date}
              onClick={() => hasTrips && onDaySelect(date)}
              disabled={!hasTrips}
              aria-label={`${date}${hasTrips ? `, ${dayTrips.length} trip${dayTrips.length !== 1 ? "s" : ""}` : ", no trips"}`}
              aria-pressed={isSelected}
              className="text-left flex flex-col gap-[6px] transition-colors"
              style={{
                padding: "9px 10px",
                minHeight: 112,
                cursor: hasTrips ? "pointer" : "default",
                background: isSelected ? "#fff" : hasTrips ? "#f6f8f8" : "#eef1f0",
                border: isSelected
                  ? "2px solid #d1541f"
                  : inCart && !isSelected
                  ? "1px solid #d1541f"
                  : "1px solid #dde4e6",
              }}
            >
              <div className={`font-plex-mono text-[14px] font-semibold ${hasTrips ? "text-hull" : "text-ink-3"}`}>
                {dayNum}
              </div>
              {hasTrips && dayTrips.slice(0, 2).map((t, j) => {
                const inCartTrip = totalQtyForTrip(t.id) > 0;
                return (
                  <div
                    key={j}
                    className="min-w-0"
                    style={{ borderLeft: `3px solid ${inCartTrip ? "#d1541f" : t.seatsRemaining === 0 ? "#9aa8ae" : "#0d1c26"}`, paddingLeft: 7, paddingTop: 3, paddingBottom: 3 }}
                  >
                    <div className="font-plex-mono text-[11px] text-ink-2 truncate">{fmtTimeET(t.startTime)}</div>
                    <div className="text-[11px] font-semibold truncate text-hull">{t.product.displayName}</div>
                  </div>
                );
              })}
              {dayTrips.length > 2 && (
                <div className="font-plex-mono text-[11px] text-orange-press">+{dayTrips.length - 2} more</div>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ─── Empty state ──────────────────────────────────────────────────────────────

function EmptyState({ onNextMonth }: { onNextMonth: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center py-24 text-center">
      <div className="font-plex-mono text-[13px] font-semibold tracking-[.1em] text-ink-3 mb-3">NO TRIPS THIS MONTH</div>
      <button
        type="button"
        onClick={onNextMonth}
        className="font-plex-mono text-[12px] font-semibold text-orange-ink underline hover:text-orange-press transition-colors tracking-[.08em]"
      >
        SEE NEXT AVAILABLE MONTH →
      </button>
    </div>
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────────

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
  const [viewMode, setViewMode] = useState<ViewMode>("calendar");
  const [selectedDay, setSelectedDay] = useState<string | null>(initialDate ?? null);
  const [vesselFilter, setVesselFilter] = useState<string>("all");

  // cart: tripId:ticketType -> quantity
  const [cart, setCart] = useState<Map<string, number>>(new Map());
  // cached prices so total stays correct across month navigation
  const [cartPrices, setCartPrices] = useState<Map<string, number>>(new Map());
  // enriched cart items (written to localStorage for checkout page)
  const [cartItems, setCartItems] = useState<EnrichedCartItem[]>([]);

  // restore cart from localStorage, then pre-add initialTripId if provided
  useEffect(() => {
    let restoredItems: EnrichedCartItem[] = [];
    try {
      const raw = localStorage.getItem("openboat_cart");
      if (raw) {
        restoredItems = JSON.parse(raw);
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

    // Pre-add 1 adult ticket for the initial trip (homepage BOOK button)
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
              tickets: [{ ticketType: adultPrice.ticketType, quantity: 1, priceCents: adultPrice.priceCents }],
            },
          ]);
          // Pre-select the day in calendar view
          setSelectedDay(trip.departureDate);
        }
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // sync cartItems to localStorage
  useEffect(() => {
    if (cartItems.length === 0) {
      localStorage.removeItem("openboat_cart");
    } else {
      localStorage.setItem("openboat_cart", JSON.stringify(cartItems));
    }
  }, [cartItems]);

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
  function totalQtyForTrip(tripId: string) {
    return Array.from(cart.entries())
      .filter(([k]) => k.startsWith(`${tripId}:`))
      .reduce((sum, [, v]) => sum + v, 0);
  }

  function setQty(tripId: string, ticketType: string, qty: number) {
    const k = `${tripId}:${ticketType}`;
    const trip = trips.find((t) => t.id === tripId);

    // update cart map
    setCart((prev) => {
      const next = new Map(prev);
      if (qty === 0) next.delete(k);
      else next.set(k, qty);
      return next;
    });

    if (!trip) return;

    // cache price for this ticket type
    const price = trip.product.prices.find((p) => p.ticketType === ticketType);
    if (price) {
      setCartPrices((prev) => {
        const next = new Map(prev);
        next.set(k, price.priceCents);
        return next;
      });
    }

    // update enriched cartItems
    setCartItems((prev) => {
      const without = prev.filter((i) => i.tripId !== tripId);
      const newTickets = trip.product.prices
        .map((p) => ({
          ticketType: p.ticketType,
          quantity:
            p.ticketType === ticketType
              ? qty
              : (prev.find((i) => i.tripId === tripId)?.tickets.find((t) => t.ticketType === p.ticketType)?.quantity ?? 0),
          priceCents: p.priceCents,
        }))
        .filter((t) => t.quantity > 0);
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
  }

  function removeFromCart(tripId: string) {
    const trip = trips.find((t) => t.id === tripId);
    const keys = trip
      ? trip.product.prices.map((p) => `${tripId}:${p.ticketType}`)
      : Array.from(cart.keys()).filter((k) => k.startsWith(`${tripId}:`));
    setCart((prev) => {
      const next = new Map(prev);
      keys.forEach((k) => next.delete(k));
      return next;
    });
    setCartItems((prev) => prev.filter((i) => i.tripId !== tripId));
  }

  const totalCents = Array.from(cart.entries()).reduce(
    (sum, [key, qty]) => sum + qty * (cartPrices.get(key) ?? 0),
    0,
  );
  const totalSeats = Array.from(cart.values()).reduce((a, b) => a + b, 0);

  function goToCheckout() {
    window.location.href = "/checkout";
  }

  // unique vessels from current month's trips
  const vessels = Array.from(
    trips.reduce((map, t) => {
      if (!map.has(t.vessel.name)) map.set(t.vessel.name, t.vessel);
      return map;
    }, new Map<string, VesselInfo>()).values()
  );

  // filter trips by vessel
  const filteredTrips = vesselFilter === "all"
    ? trips
    : trips.filter((t) => t.vessel.name === vesselFilter);

  const byDate = filteredTrips.reduce<Record<string, Trip[]>>((acc, t) => {
    (acc[t.departureDate] ??= []).push(t);
    return acc;
  }, {});
  const dates = Object.keys(byDate).sort();
  const dayTrips = selectedDay ? (byDate[selectedDay] ?? []) : [];

  return (
    <div
      className="bg-deck font-archivo"
      style={{ maxWidth: 1440, margin: "0 auto", borderLeft: "2px solid #cdd6da", borderRight: "2px solid #cdd6da", minHeight: "100vh" }}
    >
      <BookingNav
        operatorName={operatorName}
        dockAddress={dockAddress}
        phone={phone}
        step={1}
      />

      <FilterBar
        month={month}
        view={viewMode}
        filter={vesselFilter}
        vessels={vessels}
        onPrevMonth={prevMonth}
        onNextMonth={nextMonth}
        onViewChange={setViewMode}
        onFilterChange={setVesselFilter}
      />

      <div className="booking-shell">
        {/* Left: trip list / calendar */}
        <div
          className={`transition-opacity ${loading ? "opacity-40 pointer-events-none" : ""}`}
          aria-busy={loading}
          style={{ padding: "8px 24px 120px" }}
        >
          {viewMode === "list" ? (
            dates.length === 0 ? (
              <EmptyState onNextMonth={nextMonth} />
            ) : (
              dates.map((date) => (
                <DayGroup
                  key={date}
                  dateStr={date}
                  trips={byDate[date] ?? []}
                  getQty={getQty}
                  onSetQty={setQty}
                />
              ))
            )
          ) : (
            <div style={{ paddingTop: 22 }}>
              {dates.length === 0 ? (
                <EmptyState onNextMonth={nextMonth} />
              ) : (
                <>
                  <MonthGrid
                    month={month}
                    byDate={byDate}
                    selectedDay={selectedDay}
                    onDaySelect={setSelectedDay}
                    totalQtyForTrip={totalQtyForTrip}
                  />
                </>
              )}
            </div>
          )}
        </div>

        {/* Right: cart rail */}
        <CartRail
          cartItems={cartItems}
          totalCents={totalCents}
          totalSeats={totalSeats}
          selectedDay={selectedDay}
          dayTrips={dayTrips}
          getQty={getQty}
          onSetQty={setQty}
          onRemove={removeFromCart}
          onCheckout={goToCheckout}
        />
      </div>

      <MobileCartBar
        totalCents={totalCents}
        totalSeats={totalSeats}
        onCheckout={goToCheckout}
      />

      {/* Footer */}
      <div
        className="bg-hull font-plex-mono text-[12px] tracking-[.06em]"
        style={{ padding: "18px 24px", color: "#8fa3ad", borderTop: "2px solid #cdd6da", display: "flex", flexWrap: "wrap", gap: "8px 28px", justifyContent: "space-between", position: "sticky", bottom: 0, zIndex: 10 }}
      >
        <span>FREE CANCELLATION TO 24H · RODS &amp; BAIT ABOARD · WEATHER REFUNDS AUTOMATIC</span>
        <a href="/" style={{ color: "#b6c6ce", textDecoration: "none" }}>← BACK TO HOME</a>
      </div>
    </div>
  );
}
