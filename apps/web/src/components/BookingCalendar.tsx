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
    displayLabel?: string; // "seat" when all prices equal, otherwise === ticketType
  }[];
};

type ViewMode = "list" | "calendar";
type VesselInfo = { name: string; color: string };

// ─── Helpers ──────────────────────────────────────────────────────────────────

const MONTHS = [
  "January","February","March","April","May","June",
  "July","August","September","October","November","December",
];
const DAYS_LONG = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];
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
function fmtFullDate(dateStr: string) {
  const dt = new Date(dateStr + "T12:00:00Z");
  const dow = DAYS_LONG[dt.getUTCDay()];
  const mon = MONTHS[dt.getUTCMonth()];
  const day = dt.getUTCDate();
  return `${dow}, ${mon} ${day}`;
}
function dollars(cents: number) {
  return `$${Math.round(cents / 100)}`;
}
// Pluralize a ticket label for cart copy.
function pluralLabel(label: string, qty: number): string {
  if (qty === 1) return label;
  const map: Record<string, string> = {
    seat: "seats", adult: "adults", child: "children",
    senior: "seniors", military: "military",
  };
  return map[label.toLowerCase()] ?? label + "s";
}

// Returns display rows for the trip's seat selector.
// If all active prices are equal, collapses to a single "Seats" row keyed on first ticketType.
function getDisplayPrices(prices: Trip["product"]["prices"]) {
  const active = prices.filter((p) => p.priceCents > 0);
  if (active.length === 0) return [];
  const allEqual = active.every((p) => p.priceCents === active[0].priceCents);
  if (allEqual) {
    return [{ ...active[0], displayLabel: "seat" }];
  }
  return active.map((p) => ({ ...p, displayLabel: p.ticketType }));
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
      <div className="hull bg-hull px-6 flex flex-wrap gap-4 items-center justify-between" style={{ borderBottom: "3px solid #d1541f", padding: "14px 24px" }}>
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
                className={`px-[14px] py-[10px] font-plex-mono text-[13px] font-semibold tracking-[.1em] ${active ? "bg-orange text-white" : "text-ink-dark-3"}`}
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
  announceRef,
}: {
  month: string;
  view: ViewMode;
  filter: string;
  vessels: VesselInfo[];
  onPrevMonth: () => void;
  onNextMonth: () => void;
  onViewChange: (v: ViewMode) => void;
  onFilterChange: (f: string) => void;
  announceRef: React.RefObject<HTMLDivElement | null>;
}) {
  const { year, mon } = parseMonth(month);
  const monthLabel = `${MONTHS[mon - 1].toUpperCase()} ${year}`;

  function handlePrev() {
    onPrevMonth();
    if (announceRef.current) announceRef.current.textContent = `Showing ${MONTHS[mon - 2 < 0 ? 11 : mon - 2]} ${mon - 2 < 0 ? year - 1 : year}`;
  }
  function handleNext() {
    onNextMonth();
    if (announceRef.current) announceRef.current.textContent = `Showing ${MONTHS[mon % 12]} ${mon === 12 ? year + 1 : year}`;
  }

  const viewChipStyle = (active: boolean) =>
    `px-[18px] font-plex-mono text-[13px] font-semibold tracking-[.1em] cursor-pointer border transition-colors min-h-[44px] flex items-center ${
      active
        ? "bg-white text-hull border-white"
        : "bg-transparent text-ink-dark-2 border-hull-line hover:text-white"
    }`;
  const filterChipStyle = (active: boolean) =>
    `px-[16px] font-plex-mono text-[13px] font-semibold tracking-[.1em] cursor-pointer border transition-colors min-h-[44px] flex items-center gap-[6px] ${
      active
        ? "bg-orange border-orange text-white"
        : "bg-transparent border-hull-line text-white hover:border-white/50"
    }`;

  const showVesselFilter = vessels.length > 1;

  return (
    <div className="hull bg-hull-2 flex flex-wrap gap-[14px] items-center justify-between" style={{ padding: "12px 24px" }}>
      {/* Month stepper */}
      <div className="flex items-center gap-[10px]">
        <button
          type="button"
          onClick={handlePrev}
          aria-label="Previous month"
          className="flex items-center justify-center bg-transparent text-[#dfe8ec] cursor-pointer hover:text-white transition-colors"
          style={{ width: 44, height: 44, border: "1px solid #3c5867", fontSize: 18 }}
        >
          ‹
        </button>
        <span className="font-plex-mono text-[15px] font-semibold tracking-[.12em] text-white text-center" style={{ minWidth: 190 }}>
          {monthLabel}
        </span>
        <button
          type="button"
          onClick={handleNext}
          aria-label="Next month"
          className="flex items-center justify-center bg-transparent text-[#dfe8ec] cursor-pointer hover:text-white transition-colors"
          style={{ width: 44, height: 44, border: "1px solid #3c5867", fontSize: 18 }}
        >
          ›
        </button>
      </div>

      <div className="flex flex-wrap gap-[18px] items-center">
        {/* View toggle */}
        <div role="group" aria-label="View" className="flex">
          <button type="button" onClick={() => onViewChange("list")} aria-pressed={view === "list"} className={viewChipStyle(view === "list")}>LIST</button>
          <button type="button" onClick={() => onViewChange("calendar")} aria-pressed={view === "calendar"} className={viewChipStyle(view === "calendar")}>CALENDAR</button>
        </div>
        {/* Vessel filter — hidden when only 1 vessel */}
        {showVesselFilter && (
          <div role="group" aria-label="Filter by boat" className="flex flex-wrap gap-2">
            <button type="button" onClick={() => onFilterChange("all")} aria-pressed={filter === "all"} className={filterChipStyle(filter === "all")}>
              ALL
            </button>
            {vessels.map((v) => (
              <button
                key={v.name}
                type="button"
                onClick={() => onFilterChange(v.name)}
                aria-pressed={filter === v.name}
                className={filterChipStyle(filter === v.name)}
              >
                <span
                  aria-hidden="true"
                  className="inline-block rounded-full flex-shrink-0"
                  style={{ width: 7, height: 7, background: filter === v.name ? "#fff" : v.color }}
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
    <div className="flex items-stretch flex-shrink-0" style={{ border: "1px solid #0d1c26", height: 44 }}>
      <button
        type="button"
        onClick={onDec}
        disabled={value === 0}
        aria-label={decLabel}
        className="flex items-center justify-center bg-white text-hull text-[18px] font-semibold cursor-pointer disabled:opacity-40 hover:bg-deck-3 transition-colors border-none"
        style={{ width: 44, borderRight: "1px solid #0d1c26" }}
      >
        −
      </button>
      <span
        className="flex items-center justify-center font-plex-mono text-[15px] font-semibold"
        style={{ minWidth: 44 }}
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
        style={{ width: 44, borderLeft: "1px solid #0d1c26" }}
      >
        +
      </button>
    </div>
  );
}

// ─── Trip Row (list view) ──────────────────────────────────────────────────────

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

  const seatLabel =
    soldOut
      ? "SOLD OUT"
      : trip.seatsRemaining <= 10
      ? `${trip.seatsRemaining} SEATS LEFT`
      : `${trip.seatsRemaining} OPEN`;
  const seatColorClass = soldOut
    ? "text-[#9aa8ae]"
    : trip.seatsRemaining <= 10
    ? "text-[#9a3c12]"
    : "text-green-open";

  return (
    <div
      className={`booking-trip-row transition-colors ${
        inCart ? "bg-white" : "bg-deck-3"
      } ${soldOut ? "opacity-[.55]" : ""}`}
      style={{
        padding: "18px 20px",
        border: `1px solid ${inCart ? "#d1541f" : "#dde4e6"}`,
      }}
    >
      {/* Col 1: trip info */}
      <div className="trip-col-main min-w-0">
        <div className="font-plex-mono text-[12px] tracking-[.16em]" style={{ color: "#9a3c12" }}>
          {trip.product.category.toUpperCase()}
        </div>
        <div className="text-[19px] font-bold tracking-[-0.01em] mt-1 font-archivo">
          {trip.product.displayName}
        </div>
        <div className="font-plex-mono text-[13px] mt-[5px]" style={{ color: "#444141" }}>
          {fmtTimeET(trip.startTime)} – {fmtTimeET(trip.endTime)} · {fmtDuration(trip.startTime, trip.endTime)} · {trip.vessel.name}
        </div>
      </div>

      {/* Col 2: seat state */}
      <div className={`trip-col-seats font-plex-mono text-[13px] font-semibold tracking-[.06em] self-center ${seatColorClass}`}>
        {seatLabel}
      </div>

      {/* Col 3: stepper or waitlist */}
      <div className="trip-col-action flex flex-col gap-2 justify-center">
        {soldOut ? (
          <button
            type="button"
            className="font-plex-mono text-[13px] font-semibold tracking-[.1em] cursor-pointer hover:bg-deck-3 transition-colors bg-transparent"
            style={{ border: "1px solid #9aa8ae", padding: "11px 18px", color: "#444141", minHeight: 44 }}
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
                <div className="font-plex-mono text-[13px]" style={{ color: "#201e1d" }}>
                  {label.charAt(0).toUpperCase() + label.slice(1)} · {dollars(price.priceCents)}
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

// ─── Day Group ────────────────────────────────────────────────────────────────

function DayGroup({
  dateStr,
  trips,
  getQty,
  onAdjustQty,
}: {
  dateStr: string;
  trips: Trip[];
  getQty: (tripId: string, ticketType: string) => number;
  onAdjustQty: (tripId: string, ticketType: string, delta: 1 | -1) => void;
}) {
  const { main, sub } = fmtDayLabel(dateStr);
  return (
    <div style={{ paddingTop: 26 }}>
      <div className="flex items-baseline gap-3 pb-2" style={{ borderBottom: "2px solid #cdd6da" }}>
        <span className="font-plex-mono text-[13px] font-semibold tracking-[.14em] uppercase">
          {main}
        </span>
        {sub && (
          <span className="font-plex-mono text-[12px] tracking-[.08em]" style={{ color: "#444141" }}>{sub}</span>
        )}
      </div>
      {trips.map((trip) => (
        <TripRow key={trip.id} trip={trip} getQty={getQty} onAdjustQty={onAdjustQty} />
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
  selectedTripId,
  dayTrips,
  getQty,
  onAdjustQty,
  onRemove,
  onCheckout,
  tripCardRefs,
  scrollRef,
  footerRef,
  headerH,
  announceRef,
}: {
  cartItems: EnrichedCartItem[];
  totalCents: number;
  totalSeats: number;
  selectedDay: string | null;
  selectedTripId: string | null;
  dayTrips: Trip[];
  getQty: (tripId: string, ticketType: string) => number;
  onAdjustQty: (tripId: string, ticketType: string, delta: 1 | -1) => void;
  onRemove: (tripId: string) => void;
  onCheckout: () => void;
  tripCardRefs: React.MutableRefObject<Map<string, HTMLDivElement>>;
  scrollRef: React.RefObject<HTMLDivElement | null>;
  footerRef: React.RefObject<HTMLDivElement | null>;
  headerH: number;
  announceRef: React.RefObject<HTMLDivElement | null>;
}) {
  const [footerH, setFooterH] = useState(0);

  useEffect(() => {
    const footer = footerRef.current;
    if (!footer) return;
    const measure = () => setFooterH(footer.offsetHeight);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(footer);
    return () => ro.disconnect();
  }, [footerRef]);

  const hasDay = selectedDay && dayTrips.length > 0;

  return (
    <div
      className="booking-rail"
      style={{
        borderLeft: "2px solid #cdd6da",
        background: "#f8f4f4",
        position: "sticky",
        top: headerH,
        height: `calc(100vh - ${headerH}px - ${footerH}px)`,
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
      }}
    >
      {/* ── Top: day trips (scrollable) ── */}
      <div ref={scrollRef} style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "20px 20px 8px" }}>

        {hasDay ? (
          <div style={{ marginBottom: 16 }}>
            <h2 style={{ fontSize: 16, letterSpacing: "0.1em", textTransform: "uppercase", margin: "0 0 4px", color: "#201e1d" }}>
              {fmtDayLabel(selectedDay!).main.replace(/,\s*/, ", ")}
            </h2>
            <div style={{ fontSize: 13, color: "#444141", marginBottom: 12 }}>
              {dayTrips.length} {dayTrips.length === 1 ? "trip" : "trips"} · pick a departure and add seats below
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {dayTrips.map((trip) => {
                const displayPrices = getDisplayPrices(trip.product.prices);
                const soldOut = trip.seatsRemaining === 0;
                const totalQty = displayPrices.reduce((s, p) => s + getQty(trip.id, p.ticketType), 0);
                const inCart = totalQty > 0;
                const isFocused = trip.id === selectedTripId;
                return (
                  <div
                    key={`pick-${trip.id}`}
                    ref={(el) => {
                      if (el) tripCardRefs.current.set(trip.id, el);
                      else tripCardRefs.current.delete(trip.id);
                    }}
                    style={{
                      background: isFocused ? "#fdf1ec" : "#ffffff",
                      border: `${isFocused || inCart ? "2px" : "1px"} solid ${isFocused || inCart ? "#d1541f" : "#cdd6da"}`,
                      padding: "14px 16px",
                      opacity: soldOut ? 0.55 : 1,
                    }}
                  >
                    <div className="font-plex-mono text-[12px] tracking-[.16em] mb-[3px]" style={{ color: "#9a3c12" }}>
                      {trip.product.category.toUpperCase()}
                    </div>
                    <div className="flex items-baseline justify-between gap-2 mb-1">
                      <div className="font-archivo text-[16px] font-bold leading-tight">{trip.product.displayName}</div>
                      {!soldOut && trip.product.showRemaining && trip.seatsRemaining <= 10 && (
                        <div className="font-plex-mono text-[13px] font-semibold flex-shrink-0" style={{ color: "#9a3c12" }}>
                          {trip.seatsRemaining} LEFT
                        </div>
                      )}
                    </div>
                    <div className="font-plex-mono text-[13px] mb-3" style={{ color: "#444141" }}>
                      {fmtTimeET(trip.startTime)} – {fmtTimeET(trip.endTime)} · {trip.vessel.name}
                    </div>
                    {soldOut ? (
                      <div className="font-plex-mono text-[12px]" style={{ color: "#9aa8ae" }}>SOLD OUT</div>
                    ) : (
                      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                        {displayPrices.map((price) => {
                          const qty = getQty(trip.id, price.ticketType);
                          const otherQty = displayPrices
                            .filter((p) => p.ticketType !== price.ticketType)
                            .reduce((s, p) => s + getQty(trip.id, p.ticketType), 0);
                          const atMax = qty >= trip.seatsRemaining - otherQty;
                          const label = price.displayLabel ?? price.ticketType;
                          return (
                            <div key={price.ticketType} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
                              <div style={{ fontSize: 14, color: "#201e1d" }}>
                                {label.charAt(0).toUpperCase() + label.slice(1)}
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
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        ) : (
          <div style={{ border: "1px dashed #7d7979", background: "#f3f2f2", padding: "20px 18px" }}>
            <div style={{ fontSize: 17, fontWeight: 800 }}>No day chosen yet.</div>
            <div style={{ fontSize: 14, color: "#444141", marginTop: 6, lineHeight: 1.5 }}>
              Pick a day on the calendar and every trip sailing that day lands here — departure window, boat, seats left and its own fare.
            </div>
          </div>
        )}
      </div>

      {/* ── Bottom: Your seats (permanent) ── */}
      <div style={{ flexShrink: 0, borderTop: "2px solid #d7d3d3", background: "#f8f4f4" }}>
        <h2 style={{ fontSize: 14, letterSpacing: "0.14em", textTransform: "uppercase", margin: 0, padding: "14px 20px 10px", color: "#201e1d" }}>
          Your seats
        </h2>
        <div style={{ padding: "0 20px", maxHeight: 260, overflowY: "auto" }}>

          {cartItems.length === 0 ? (
            <div style={{ border: "1px dashed #7d7979", padding: "18px 16px", background: "transparent", marginBottom: 14 }}>
              <div className="text-[16px] font-bold font-archivo">No seats yet.</div>
              <div className="text-[14px] mt-1" style={{ lineHeight: 1.5, color: "#444141" }}>
                Pick a day, then hit <strong>+</strong> on a trip.
              </div>
            </div>
          ) : (
            <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column" }}>
              {cartItems.map((item) => {
                const subtotal = item.tickets.reduce((s, t) => s + t.quantity * t.priceCents, 0);
                const seatsLabel = item.tickets
                  .map((t) => {
                    const lbl = t.displayLabel ?? t.ticketType;
                    return `${t.quantity} ${pluralLabel(lbl, t.quantity)}`;
                  })
                  .join(" · ");
                const dateShort = new Date(item.departureDate + "T12:00:00Z").toLocaleDateString("en-US", {
                  month: "short", day: "numeric", timeZone: "UTC",
                });
                return (
                  <li
                    key={`cart-${item.tripId}`}
                    style={{ padding: "12px 0", borderBottom: "1px solid #d7d3d3" }}
                  >
                    <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12 }}>
                      <div className="font-archivo text-[15px] font-bold">{item.productName}</div>
                      <div className="font-plex-mono text-[15px] font-bold flex-shrink-0">{dollars(subtotal)}</div>
                    </div>
                    <div className="font-plex-mono text-[13px] mt-[2px]" style={{ color: "#444141" }}>
                      {dateShort} · {fmtTimeET(item.startTime)}
                    </div>
                    <div className="font-plex-mono text-[13px]" style={{ color: "#201e1d" }}>
                      {seatsLabel}
                    </div>
                    <button
                      type="button"
                      onClick={() => onRemove(item.tripId)}
                      aria-label={`Remove ${item.productName} from cart`}
                      className="font-plex-mono text-[13px] font-semibold tracking-[.06em] cursor-pointer bg-transparent border-none mt-[3px] underline"
                      style={{ color: "#9a3c12", padding: "6px 0", minHeight: 44, display: "block" }}
                    >
                      REMOVE
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {/* Checkout */}
        {cartItems.length > 0 && (
          <div style={{ padding: "14px 20px 20px", borderTop: "2px solid #201e1d", background: "#f3f2f2" }}>
            <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12 }}>
              <div className="font-plex-mono text-[14px] tracking-[.14em] uppercase" style={{ color: "#444141" }}>Total</div>
              <div className="font-plex-mono text-[34px] font-bold" style={{ lineHeight: 1 }}>{dollars(totalCents)}</div>
            </div>
            <div className="font-plex-mono text-[13px] mt-1" style={{ color: "#444141" }}>
              {totalSeats} {totalSeats === 1 ? "seat" : "seats"}
            </div>
            <button
              type="button"
              onClick={onCheckout}
              className="w-full bg-orange text-white font-archivo text-[17px] font-bold tracking-[.06em] uppercase cursor-pointer hover:bg-orange-press transition-colors border-none flex items-center justify-between gap-3 mt-[14px]"
              style={{ padding: "0 18px", minHeight: 56 }}
            >
              <span>CHECK OUT</span>
              <span>{dollars(totalCents)} →</span>
            </button>
            <div className="font-plex-mono text-[13px] mt-[10px]" style={{ lineHeight: 1.7, color: "#201e1d" }}>
              Pay in full now · Free cancellation up to 24h before departure · Automatic refund if weather cancels the trip.
            </div>
          </div>
        )}
      </div>
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
        <div className="font-plex-mono text-[13px] tracking-[.14em] text-ink-dark-3">
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

// ─── Calendar grid ────────────────────────────────────────────────────────────

function MonthGrid({
  month,
  byDate,
  selectedDay,
  selectedTripId,
  onDaySelect,
  onTripSelect,
  totalQtyForTrip,
  announceRef,
}: {
  month: string;
  byDate: Record<string, Trip[]>;
  selectedDay: string | null;
  selectedTripId: string | null;
  onDaySelect: (d: string) => void;
  onTripSelect: (d: string, tripId: string) => void;
  totalQtyForTrip: (id: string) => number;
  announceRef: React.RefObject<HTMLDivElement | null>;
}) {
  const { year, mon } = parseMonth(month);
  const firstDow = new Date(Date.UTC(year, mon - 1, 1)).getUTCDay();
  const lastDay = new Date(Date.UTC(year, mon, 0)).getUTCDate();
  const today = new Date().toISOString().slice(0, 10);
  const days = Array.from({ length: lastDay }, (_, i) => `${month}-${String(i + 1).padStart(2,"0")}`);
  const cells: (string | null)[] = [...Array(firstDow).fill(null), ...days];
  while (cells.length % 7 !== 0) cells.push(null);

  // Build week rows
  const weeks: (string | null)[][] = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));

  // Roving tabindex: the selected day (or first day with trips) is the tab stop
  const firstTripsDay = days.find((d) => (byDate[d]?.length ?? 0) > 0);
  const tabDay = selectedDay ?? firstTripsDay ?? days[0];

  return (
    <div>
      <div className="grid grid-cols-7 mb-2">
        {DAYS_SHORT.map((d) => (
          <div key={d} className="font-plex-mono text-[12px] font-semibold tracking-[.12em] pb-[4px]" style={{ color: "#444141" }}>{d}</div>
        ))}
      </div>
      <div role="grid" aria-label="Trip calendar" className="grid grid-cols-7 gap-[6px]">
        {weeks.map((week, wi) => (
          <div key={wi} role="row" style={{ display: "contents" }}>
            {week.map((date, ci) => {
              if (!date) {
                return (
                  <div
                    key={`empty-${wi}-${ci}`}
                    role="gridcell"
                    aria-hidden="true"
                    style={{ background: "#eceaea", border: "1px solid #d7d3d3", minHeight: 128 }}
                  />
                );
              }

              const dayTrips = byDate[date] ?? [];
              const isSelected = date === selectedDay;
              const isToday = date === today;
              const hasTrips = dayTrips.length > 0;
              const inCart = dayTrips.some((t) => totalQtyForTrip(t.id) > 0);
              const dayNum = parseInt(date.slice(-2));
              const dtObj = new Date(date + "T12:00:00Z");
              const fullDateLabel = `${DAYS_LONG[dtObj.getUTCDay()]}, ${MONTHS[dtObj.getUTCMonth()]} ${dayNum}`;
              const tripCount = dayTrips.length;
              const ariaLabel = `${fullDateLabel}${isToday ? ", today" : ""}${hasTrips ? `, ${tripCount} ${tripCount === 1 ? "trip" : "trips"}` : ", no trips"}`;

              const cellBg = !hasTrips ? "#eceaea" : isSelected ? "#fdf1ec" : "#f8f4f4";
              const cellBorder = isSelected
                ? "2px solid #d1541f"
                : inCart && !isSelected
                ? "1px solid #d1541f"
                : "1px solid #d7d3d3";

              return (
                <div
                  key={date}
                  role="gridcell"
                  onClick={() => hasTrips && onDaySelect(date)}
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: 0,
                    alignItems: "flex-start",
                    minHeight: 128,
                    padding: "9px 8px",
                    background: cellBg,
                    border: cellBorder,
                    cursor: hasTrips ? "pointer" : "default",
                    width: "100%",
                  }}
                >
                  {/* Day numeral — accessible button, carries keyboard handling */}
                  <button
                    type="button"
                    data-iso={date}
                    tabIndex={date === tabDay ? 0 : -1}
                    aria-label={ariaLabel}
                    aria-pressed={isSelected}
                    aria-current={isToday ? "date" : undefined}
                    disabled={!hasTrips}
                    onClick={(e) => {
                      e.stopPropagation();
                      if (hasTrips) {
                        onDaySelect(date);
                        if (announceRef.current) {
                          announceRef.current.textContent = `${fullDateLabel} selected, ${tripCount} ${tripCount === 1 ? "trip" : "trips"}`;
                        }
                      }
                    }}
                    onKeyDown={(e) => {
                      const grid = e.currentTarget.closest("[role='grid']");
                      if (!grid) return;
                      const allButtons = Array.from(grid.querySelectorAll<HTMLButtonElement>("button[data-iso]"));
                      const idx = allButtons.indexOf(e.currentTarget);
                      const moves: Record<string, number> = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: 7, ArrowUp: -7 };
                      if (moves[e.key] !== undefined) {
                        e.preventDefault();
                        const next = allButtons[idx + moves[e.key]];
                        if (next) next.focus();
                      }
                    }}
                    style={{
                      background: "none",
                      border: 0,
                      padding: isToday ? "0 0 1px" : 0,
                      fontFamily: "inherit",
                      cursor: hasTrips ? "pointer" : "default",
                      fontSize: 16,
                      fontWeight: 800,
                      color: hasTrips ? "#201e1d" : "#7d7979",
                      borderBottom: isToday ? "3px solid #d1541f" : "none",
                      marginBottom: hasTrips ? 6 : 0,
                    }}
                  >
                    {dayNum}
                  </button>

                  {/* Trip rows — full list, no truncation */}
                  {hasTrips && (
                    <div style={{ display: "flex", flexDirection: "column", alignItems: "stretch", width: "100%", minWidth: 0 }}>
                      {dayTrips.map((t, i) => {
                        const low = t.product.showRemaining && t.seatsRemaining <= 6;
                        const isRowFocused = t.id === selectedTripId && isSelected;
                        const adultPrice = t.product.prices[0];
                        return (
                          <button
                            key={t.id}
                            type="button"
                            tabIndex={isSelected ? 0 : -1}
                            aria-label={`${t.product.displayName}, ${fmtTimeET(t.startTime)}, ${t.vessel.name}${t.vessel.code ? ` (${t.vessel.code})` : ""}, ${adultPrice ? dollars(adultPrice.priceCents) : ""}${low ? `, only ${t.seatsRemaining} left` : ""} — open this trip`}
                            aria-pressed={isRowFocused}
                            onClick={(e) => {
                              e.stopPropagation();
                              onTripSelect(date, t.id);
                              if (announceRef.current) {
                                announceRef.current.textContent = `${t.product.displayName} at ${fmtTimeET(t.startTime)} on ${fmtFullDate(date)} — ${dayTrips.length} ${dayTrips.length === 1 ? "trip" : "trips"} that day`;
                              }
                            }}
                            style={{
                              boxSizing: "border-box",
                              display: "flex",
                              flexDirection: "column",
                              gap: 1,
                              minWidth: 0,
                              width: "100%",
                              fontFamily: "inherit",
                              textAlign: "left",
                              cursor: "pointer",
                              background: isRowFocused ? "#fbe0d3" : "transparent",
                              padding: "5px 0 5px 7px",
                              border: 0,
                              borderLeft: `4px solid ${t.vessel.color}`,
                              borderBottom: i < dayTrips.length - 1 ? "1px solid #e0dcdc" : "none",
                            }}
                          >
                            <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 6 }}>
                              <span style={{ fontSize: 13, fontWeight: 700, whiteSpace: "nowrap", color: "#201e1d" }}>
                                {fmtTimeET(t.startTime)}
                              </span>
                              {adultPrice && (
                                <span style={{ fontSize: 13, color: "#201e1d", flexShrink: 0 }}>
                                  {dollars(adultPrice.priceCents)}
                                </span>
                              )}
                            </div>
                            <div style={{ display: "flex", alignItems: "baseline", flexWrap: "wrap", gap: 5 }}>
                              <span style={{ fontSize: 12, lineHeight: 1.25, color: "#444141", textAlign: "left" }}>
                                {t.product.displayName}
                              </span>
                              {t.vessel.code && (
                                <span style={{ fontSize: 12, fontWeight: 600, letterSpacing: "0.04em", color: "#201e1d" }}>
                                  {t.vessel.code}
                                </span>
                              )}
                              {low && (
                                <span style={{ fontSize: 12, fontWeight: 600, color: "#9a3c12", marginLeft: "auto", paddingLeft: 6, whiteSpace: "nowrap" }}>
                                  {t.seatsRemaining} left
                                </span>
                              )}
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        ))}
      </div>
      <p style={{ margin: "16px 0 0", fontSize: 13, color: "#444141", maxWidth: "62ch" }}>
        Every sailing that day is listed, with the adult fare. Pick a day to see every ticket type and add seats.
      </p>
    </div>
  );
}

// ─── Empty state ──────────────────────────────────────────────────────────────

function EmptyState({ onNextMonth }: { onNextMonth: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center py-24 text-center">
      <div className="font-plex-mono text-[13px] font-semibold tracking-[.1em] mb-3" style={{ color: "#7d7979" }}>NO TRIPS THIS MONTH</div>
      <button
        type="button"
        onClick={onNextMonth}
        className="font-plex-mono text-[13px] font-semibold underline hover:opacity-75 transition-opacity tracking-[.08em]"
        style={{ color: "#9a3c12" }}
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
  const [selectedTripId, setSelectedTripId] = useState<string | null>(null);
  const [vesselFilter, setVesselFilter] = useState<string>("all");
  const [headerH, setHeaderH] = useState(0);

  // cart: tripId:ticketType -> quantity
  const [cart, setCart] = useState<Map<string, number>>(new Map());
  // cached prices so total stays correct across month navigation
  const [cartPrices, setCartPrices] = useState<Map<string, number>>(new Map());
  // enriched cart items (written to localStorage for checkout page)
  const [cartItems, setCartItems] = useState<EnrichedCartItem[]>([]);

  // Refs for scroll targeting
  const tripCardRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const railScrollRef = useRef<HTMLDivElement>(null);
  const footerRef = useRef<HTMLDivElement>(null);
  const announceRef = useRef<HTMLDivElement>(null);
  const headerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = headerRef.current;
    if (!el) return;
    const measure = () => setHeaderH(el.offsetHeight);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Restore cart from localStorage, then pre-add initialTripId if provided
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
          setSelectedDay(trip.departureDate);
        }
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Sync cartItems to localStorage
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

  // Scroll to focused trip card after selectedTripId changes
  useEffect(() => {
    if (!selectedTripId) return;
    requestAnimationFrame(() => {
      const card = tripCardRefs.current.get(selectedTripId);
      const rail = railScrollRef.current;
      if (!card) return;
      if (rail && rail.scrollHeight > rail.clientHeight + 4) {
        rail.scrollTo({
          top: rail.scrollTop + card.getBoundingClientRect().top - rail.getBoundingClientRect().top - 12,
          behavior: "smooth",
        });
      } else {
        window.scrollTo({
          top: card.getBoundingClientRect().top + window.scrollY - 90,
          behavior: "smooth",
        });
      }
    });
  }, [selectedTripId]);

  const { year, mon } = parseMonth(month);

  async function goToMonth(m: string) {
    setLoading(true);
    const data = await fetch(`/api/trips?month=${m}`).then((r) => r.json());
    setTrips(data);
    setMonth(m);
    setSelectedDay(null);
    setSelectedTripId(null);
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

  // §4: Delta-based functional state update — prevents stale-closure seat drops on rapid taps.
  // Both setCart and setCartItems derive new quantities from their own prev, never from the render
  // closure. Flag: no other setState(absoluteValue) patterns remain in the stepper path.
  const adjustQty = useCallback((tripId: string, ticketType: string, delta: 1 | -1) => {
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
    const isCollapsed = displayPrices.length === 1 && displayPrices[0].displayLabel === "seat";
    const displayLabel = isCollapsed ? "seat" : ticketType;

    setCartItems((prev) => {
      const existing = prev.find((i) => i.tripId === tripId);
      const without = prev.filter((i) => i.tripId !== tripId);

      const existingQty = existing?.tickets.find((t) => t.ticketType === ticketType)?.quantity ?? 0;
      const otherTickets = existing?.tickets.filter((t) => t.ticketType !== ticketType) ?? [];
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

  }, [trips]);

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
    setCartItems((prev) => prev.filter((i) => i.tripId !== tripId));
    if (announceRef.current) announceRef.current.textContent = `${item?.productName ?? "Trip"} removed`;
  }

  const totalCents = Array.from(cart.entries()).reduce(
    (sum, [key, qty]) => sum + qty * (cartPrices.get(key) ?? 0),
    0,
  );
  const totalSeats = Array.from(cart.values()).reduce((a, b) => a + b, 0);

  function handleDaySelect(date: string) {
    setSelectedDay(date);
    setSelectedTripId(null);
  }

  function handleTripSelect(date: string, tripId: string) {
    setSelectedDay(date);
    setSelectedTripId(tripId);
  }

  function goToCheckout() {
    window.location.href = "/checkout";
  }

  // Unique vessels from current month's trips
  const vessels = Array.from(
    trips.reduce((map, t) => {
      if (!map.has(t.vessel.name)) map.set(t.vessel.name, t.vessel);
      return map;
    }, new Map<string, VesselInfo>()).values()
  );

  // Filter trips by vessel
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
      {/* aria-live region for announcements */}
      <div
        ref={announceRef}
        aria-live="polite"
        aria-atomic="true"
        style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0 0 0 0)", whiteSpace: "nowrap" }}
      />

      <div ref={headerRef} style={{ position: "sticky", top: 0, zIndex: 50 }}>
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
          announceRef={announceRef}
        />
      </div>

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
                  onAdjustQty={adjustQty}
                />
              ))
            )
          ) : (
            <div style={{ paddingTop: 22 }}>
              {dates.length === 0 ? (
                <EmptyState onNextMonth={nextMonth} />
              ) : (
                <MonthGrid
                  month={month}
                  byDate={byDate}
                  selectedDay={selectedDay}
                  selectedTripId={selectedTripId}
                  onDaySelect={handleDaySelect}
                  onTripSelect={handleTripSelect}
                  totalQtyForTrip={totalQtyForTrip}
                  announceRef={announceRef}
                />
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
          selectedTripId={selectedTripId}
          dayTrips={dayTrips}
          getQty={getQty}
          onAdjustQty={adjustQty}
          onRemove={removeFromCart}
          onCheckout={goToCheckout}
          tripCardRefs={tripCardRefs}
          scrollRef={railScrollRef}
          footerRef={footerRef}
          headerH={headerH}
          announceRef={announceRef}
        />
      </div>

      <MobileCartBar
        totalCents={totalCents}
        totalSeats={totalSeats}
        onCheckout={goToCheckout}
      />

      {/* Footer */}
      <div
        ref={footerRef}
        className="hull bg-hull font-plex-mono text-[13px] tracking-[.04em]"
        style={{ padding: "16px 24px", color: "#c9d2d8", borderTop: "2px solid #201e1d", display: "flex", flexWrap: "wrap", gap: "8px 28px", justifyContent: "space-between", position: "sticky", bottom: 0, zIndex: 10 }}
      >
        <span>FREE CANCELLATION TO 24H · RODS &amp; BAIT ABOARD · WEATHER REFUNDS AUTOMATIC</span>
        <a href="/" style={{ color: "#ffffff", textDecoration: "none" }}>← BACK TO HOME</a>
      </div>
    </div>
  );
}
