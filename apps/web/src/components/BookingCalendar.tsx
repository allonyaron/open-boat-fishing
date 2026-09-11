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
type TripFilter = "all" | "half-day" | "full-day" | "weekend";

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
function tripDurationHours(trip: Trip) {
  return (new Date(trip.endTime).getTime() - new Date(trip.startTime).getTime()) / 3600000;
}
function fmtFare(prices: { ticketType: string; priceCents: number }[]) {
  if (prices.length === 0) return "";
  const min = Math.min(...prices.map((p) => p.priceCents));
  const dollars = Math.round(min / 100);
  return prices.length > 1 ? `from $${dollars}` : `$${dollars}`;
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
        <span className="text-[22px] font-bold tracking-[.05em] text-white uppercase font-archivo">
          {operatorName}
        </span>
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
  onPrevMonth,
  onNextMonth,
  onViewChange,
  onFilterChange,
}: {
  month: string;
  view: ViewMode;
  filter: TripFilter;
  onPrevMonth: () => void;
  onNextMonth: () => void;
  onViewChange: (v: ViewMode) => void;
  onFilterChange: (f: TripFilter) => void;
}) {
  const { year, mon } = parseMonth(month);
  const monthLabel = `${MONTHS[mon - 1].toUpperCase()} ${year}`;
  const filters: { key: TripFilter; label: string }[] = [
    { key: "all", label: "ALL TRIPS" },
    { key: "half-day", label: "HALF-DAY" },
    { key: "full-day", label: "FULL-DAY" },
    { key: "weekend", label: "WEEKEND" },
  ];
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
        {/* Trip type filter */}
        <div className="flex flex-wrap gap-2">
          {filters.map(({ key, label }) => (
            <button key={key} type="button" onClick={() => onFilterChange(key)} className={filterChipStyle(filter === key)}>
              {label}
            </button>
          ))}
        </div>
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
    <div>
      {label && (
        <div className="font-plex-mono text-[10px] font-semibold tracking-[.12em] text-ink-dark-3 mb-[4px]">
          {label}
        </div>
      )}
      <div className="flex items-stretch" style={{ border: "1px solid #0d1c26", height: 46 }}>
        <button
          type="button"
          onClick={onDec}
          disabled={value === 0}
          aria-label="One fewer seat"
          className="flex items-center justify-center bg-white text-hull text-[20px] font-semibold cursor-pointer disabled:opacity-40 hover:bg-deck-3 transition-colors border-none"
          style={{ width: 46, borderRight: "1px solid #0d1c26" }}
        >
          −
        </button>
        <span
          className="flex items-center justify-center font-plex-mono text-[17px] font-semibold"
          style={{ minWidth: 46 }}
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
          className="flex items-center justify-center bg-hull text-white text-[20px] font-semibold cursor-pointer disabled:opacity-40 hover:bg-hull-2 transition-colors border-none"
          style={{ width: 46, borderLeft: "1px solid #0d1c26" }}
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
      : "SEATS OPEN";
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

      {/* Col 2: fare */}
      <div className="trip-col-fare font-plex-mono text-[20px] font-semibold self-center whitespace-nowrap">
        {fmtFare(activePrices)}
      </div>

      {/* Col 3: seat state */}
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
                label={activePrices.length > 1 ? price.ticketType.toUpperCase() : undefined}
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
  onRemove,
  onCheckout,
}: {
  cartItems: EnrichedCartItem[];
  totalCents: number;
  totalSeats: number;
  onRemove: (tripId: string) => void;
  onCheckout: () => void;
}) {
  return (
    <div
      className="booking-rail flex flex-col gap-[18px]"
      style={{
        borderLeft: "2px solid #cdd6da",
        background: "#e6eaea",
        minHeight: "100vh",
        padding: "28px 22px",
        position: "sticky",
        top: 0,
      }}
    >
      <div className="font-plex-mono text-[12px] tracking-[.16em] text-ink-2">YOUR SEATS</div>

      {cartItems.length === 0 ? (
        <div style={{ border: "1px dashed #a9b6bc", padding: 22, background: "#eef1f0" }}>
          <div className="text-[17px] font-bold font-archivo">No seats yet.</div>
          <div className="text-[15px] text-ink-2 mt-[6px]" style={{ lineHeight: 1.5 }}>
            Hit <strong>+</strong> on any trip. Nothing is charged until you pay.
          </div>
        </div>
      ) : (
        <>
          {cartItems.map((item) => {
            const subtotal = item.tickets.reduce((s, t) => s + t.quantity * t.priceCents, 0);
            const seatsLabel = item.tickets
              .map((t) => `${t.quantity} ${t.ticketType}`)
              .join(" · ");
            const { main: dateMain } = fmtDayLabel(item.departureDate);
            const dateShort = (() => {
              const dt = new Date(item.departureDate + "T12:00:00Z");
              return dt.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
            })();
            return (
              <div key={item.tripId} style={{ background: "#fff", border: "1px solid #cdd6da", padding: 16 }}>
                <div className="flex justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-[16px] font-bold font-archivo truncate">{item.productName}</div>
                    <div className="font-plex-mono text-[12px] text-ink-2 mt-1">
                      {dateShort} · {fmtTimeET(item.startTime)}
                    </div>
                    <div className="font-plex-mono text-[12px] text-ink-2 mt-[2px]">
                      {seatsLabel} × {dollars(item.tickets[0]?.priceCents ?? 0)}
                    </div>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <div className="font-plex-mono text-[17px] font-semibold">{dollars(subtotal)}</div>
                    <button
                      type="button"
                      onClick={() => onRemove(item.tripId)}
                      className="font-plex-mono text-[11px] tracking-[.1em] text-orange-press cursor-pointer bg-transparent border-none mt-[6px] underline hover:text-orange-ink"
                    >
                      REMOVE
                    </button>
                  </div>
                </div>
              </div>
            );
          })}

          <div>
            <div className="flex justify-between items-baseline pt-[14px]" style={{ borderTop: "2px solid #cdd6da" }}>
              <span className="font-plex-mono text-[12px] tracking-[.16em] text-ink-2">TOTAL</span>
              <span className="font-plex-mono text-[30px] font-bold">{dollars(totalCents)}</span>
            </div>
            <button
              type="button"
              onClick={onCheckout}
              className="w-full bg-orange text-white font-archivo text-[16px] font-bold tracking-[.08em] uppercase cursor-pointer hover:bg-orange-press transition-colors border-none mt-[14px]"
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
        </>
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
}: {
  initialTrips: Trip[];
  initialMonth: string;
  operatorName: string;
  phone: string | null;
  dockAddress: string | null;
  termsUrl: string | null;
}) {
  const [month, setMonth] = useState(initialMonth);
  const [trips, setTrips] = useState<Trip[]>(initialTrips);
  const [loading, setLoading] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>("list");
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const [tripFilter, setTripFilter] = useState<TripFilter>("all");

  // cart: tripId:ticketType -> quantity
  const [cart, setCart] = useState<Map<string, number>>(new Map());
  // cached prices so total stays correct across month navigation
  const [cartPrices, setCartPrices] = useState<Map<string, number>>(new Map());
  // enriched cart items (written to localStorage for checkout page)
  const [cartItems, setCartItems] = useState<EnrichedCartItem[]>([]);

  // restore cart from localStorage on mount
  useEffect(() => {
    try {
      const raw = localStorage.getItem("openboat_cart");
      if (!raw) return;
      const items: EnrichedCartItem[] = JSON.parse(raw);
      const map = new Map<string, number>();
      const prices = new Map<string, number>();
      items.forEach((item) => {
        item.tickets.forEach((t) => {
          map.set(`${item.tripId}:${t.ticketType}`, t.quantity);
          prices.set(`${item.tripId}:${t.ticketType}`, t.priceCents);
        });
      });
      if (map.size > 0) setCart(map);
      if (prices.size > 0) setCartPrices(prices);
      if (items.length > 0) setCartItems(items);
    } catch { /* ignore corrupt data */ }
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
    posthog.capture("list_view");
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

  // filter trips
  const filteredTrips = trips.filter((t) => {
    if (tripFilter === "half-day" && tripDurationHours(t) >= 6) return false;
    if (tripFilter === "full-day" && tripDurationHours(t) < 6) return false;
    if (tripFilter === "weekend") {
      const dow = new Date(t.departureDate + "T12:00:00Z").getUTCDay();
      if (dow !== 0 && dow !== 6) return false;
    }
    return true;
  });

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
        filter={tripFilter}
        onPrevMonth={prevMonth}
        onNextMonth={nextMonth}
        onViewChange={setViewMode}
        onFilterChange={setTripFilter}
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
                  {selectedDay && dayTrips.length > 0 && (
                    <div style={{ paddingTop: 30 }}>
                      <div className="flex items-baseline gap-3 pb-2" style={{ borderBottom: "2px solid #cdd6da" }}>
                        <span className="font-plex-mono text-[13px] font-semibold tracking-[.14em] uppercase">
                          {fmtDayLabel(selectedDay).main}
                        </span>
                        <span className="font-plex-mono text-[12px] text-ink-3 tracking-[.08em]">PICK YOUR SEATS</span>
                      </div>
                      {dayTrips.map((trip) => (
                        <TripRow key={trip.id} trip={trip} getQty={getQty} onSetQty={setQty} />
                      ))}
                    </div>
                  )}
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
          onRemove={removeFromCart}
          onCheckout={goToCheckout}
        />
      </div>

      <MobileCartBar
        totalCents={totalCents}
        totalSeats={totalSeats}
        onCheckout={goToCheckout}
      />
    </div>
  );
}
