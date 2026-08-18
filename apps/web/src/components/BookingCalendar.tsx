"use client";

import { useState, useEffect } from "react";
import posthog from "posthog-js";
import { dollars } from "@openboat/utils";
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
    ticketType: "adult" | "child";
    quantity: number;
    priceCents: number;
  }[];
};

type ViewMode = "list" | "calendar";

// ─── Helpers ──────────────────────────────────────────────────────────────────

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];
const DAYS_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function toMonthStr(year: number, mon: number) {
  return `${year}-${String(mon).padStart(2, "0")}`;
}
function parseMonth(month: string) {
  const [y, m] = month.split("-").map(Number);
  return { year: y, mon: m };
}
function fmtDayHeader(dateStr: string) {
  return new Date(dateStr + "T12:00:00Z").toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
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
function calCellStatus(t: Trip): { label: string; color: string } {
  if (t.seatsRemaining === 0) return { label: "Sold out", color: "#c65b4e" };
  if (t.seatsRemaining <= 5) return { label: `${t.seatsRemaining} left`, color: "#c9862f" };
  return { label: `${t.seatsRemaining} left`, color: "#3f8f5e" };
}

// ─── Stepper ──────────────────────────────────────────────────────────────────

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
        className="w-9 h-9 rounded-pill bg-navy text-white flex items-center justify-center text-lg hover:bg-navy-medium transition-colors disabled:bg-disabled disabled:text-disabled-text"
      >
        +
      </button>
    </div>
  );
}

// ─── Trip Row ─────────────────────────────────────────────────────────────────

function TripRow({
  trip,
  cartQty,
  onSelect,
}: {
  trip: Trip;
  cartQty: number;
  onSelect: () => void;
}) {
  const soldOut = trip.seatsRemaining === 0;
  const seats = trip.seatsRemaining;
  const threshold40 = Math.round(trip.capacity * 0.4);

  let badge: React.ReactNode = null;
  if (soldOut) {
    badge = (
      <span className="text-11 font-semibold text-warning bg-warning-bg px-2 py-0.5 rounded-pill">
        Sold out
      </span>
    );
  } else if (seats <= 3) {
    badge = (
      <span className="text-11 font-semibold text-warning bg-warning-bg px-2 py-0.5 rounded-pill">
        {seats} left
      </span>
    );
  } else if (seats <= threshold40) {
    badge = (
      <span className="text-11 font-semibold text-faint bg-fill px-2 py-0.5 rounded-pill">
        {seats} seats left
      </span>
    );
  } else {
    badge = (
      <span className="text-11 font-semibold text-success bg-success-bg px-2 py-0.5 rounded-pill">
        {seats} seats left
      </span>
    );
  }

  const fromPrice =
    trip.product.prices.length > 0
      ? Math.min(...trip.product.prices.map((p) => p.priceCents))
      : null;
  const tripLabel = [
    soldOut ? "Sold out:" : null,
    trip.product.displayName,
    "on",
    trip.vessel.name,
    `${fmtTimeET(trip.startTime)}–${fmtTimeET(trip.endTime)}`,
    fromPrice !== null ? `from ${dollars(fromPrice)}` : null,
  ]
    .filter(Boolean)
    .join(", ");

  return (
    <button
      type="button"
      onClick={onSelect}
      disabled={soldOut}
      aria-label={tripLabel}
      className={`w-full text-left flex items-center gap-3 p-4 bg-white rounded-2xl border transition-all ${
        soldOut
          ? "border-hairline opacity-60 cursor-not-allowed"
          : cartQty > 0
            ? "border-gold shadow-card-selected"
            : "border-card-border shadow-card hover:border-gold/40"
      }`}
    >
      <div
        className="w-1 self-stretch rounded-pill flex-shrink-0"
        style={{ backgroundColor: trip.vessel.color }}
      />
      <div className="flex-1 min-w-0">
        <div className="text-11 font-bold uppercase tracking-wide text-gold mb-0.5">
          {trip.product.category}
        </div>
        <div className="font-grotesk text-15 font-bold text-navy truncate">
          {trip.product.displayName}
        </div>
        <div className="text-13 text-muted mt-0.5">
          {trip.vessel.name} · {fmtTimeET(trip.startTime)} – {fmtTimeET(trip.endTime)} ·{" "}
          {fmtDuration(trip.startTime, trip.endTime)}
        </div>
        {fromPrice !== null && (
          <div className="text-13 text-ink font-semibold mt-0.5">from {dollars(fromPrice)}</div>
        )}
      </div>
      <div className="flex flex-col items-end gap-1.5 flex-shrink-0">
        {cartQty > 0 && (
          <span className="text-11 font-bold text-gold bg-gold/10 border border-gold/30 px-2 py-0.5 rounded-pill">
            {cartQty} in cart
          </span>
        )}
        {badge}
        <ChevronRight />
      </div>
    </button>
  );
}

// ─── Month Grid (desktop calendar view) ───────────────────────────────────────

function MonthGrid({
  month,
  byDate,
  selectedDay,
  onDaySelect,
}: {
  month: string;
  byDate: Record<string, Trip[]>;
  selectedDay: string | null;
  onDaySelect: (d: string) => void;
}) {
  const { year, mon } = parseMonth(month);
  const firstDow = new Date(Date.UTC(year, mon - 1, 1)).getUTCDay();
  const lastDay = new Date(Date.UTC(year, mon, 0)).getUTCDate();
  const today = new Date().toISOString().slice(0, 10);

  const days = Array.from(
    { length: lastDay },
    (_, i) => `${month}-${String(i + 1).padStart(2, "0")}`,
  );
  const cells: (string | null)[] = [...Array(firstDow).fill(null), ...days];
  while (cells.length % 7 !== 0) cells.push(null);

  return (
    <div>
      <div className="grid grid-cols-7 mb-2">
        {DAYS_SHORT.map((d) => (
          <div key={d} className="text-center text-11 font-bold text-faint uppercase py-2">
            {d}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-1.5">
        {cells.map((date, i) => {
          if (!date) return <div key={i} />;
          const trips = byDate[date] ?? [];
          const isSelected = date === selectedDay;
          const isToday = date === today;
          const hasTrips = trips.length > 0;
          const dayNum = parseInt(date.slice(-2));

          const dayLabel = hasTrips
            ? `${date}, ${trips.length} trip${trips.length !== 1 ? "s" : ""} available`
            : `${date}, no trips`;

          return (
            <button
              key={date}
              onClick={() => hasTrips && onDaySelect(date)}
              disabled={!hasTrips}
              aria-label={dayLabel}
              aria-pressed={isSelected}
              className={`min-h-[200px] rounded-xl p-[10px] text-left transition-all flex flex-col gap-[6px] ${
                isSelected
                  ? "border-2 border-gold bg-gold-tint"
                  : hasTrips
                    ? "bg-white border border-card-border hover:border-gold/40 shadow-card cursor-pointer"
                    : "bg-fill/60 border border-hairline cursor-default"
              } ${isToday && !isSelected ? "ring-2 ring-gold/40" : ""}`}
            >
              <div
                className="font-manrope text-14 font-bold"
                style={{ color: hasTrips ? "#1c2333" : "#9a9fac" }}
              >
                {dayNum}
              </div>
              {hasTrips && (
                <>
                  {trips.slice(0, 3).map((t, j) => {
                    const { label, color } = calCellStatus(t);
                    return (
                      <div key={j} className="flex gap-[6px] min-w-0">
                        <div
                          className="w-[2px] rounded-full flex-shrink-0 self-stretch"
                          style={{ backgroundColor: t.vessel.color }}
                        />
                        <div className="min-w-0 flex-1">
                          <div className="text-10 font-bold leading-tight" style={{ color: "#14233d" }}>
                            {fmtTimeET(t.startTime)}
                          </div>
                          <div className="text-10 leading-[1.25] truncate" style={{ color: "#3d4250" }}>
                            {t.product.displayName}
                          </div>
                          <div className="text-9 font-bold" style={{ color }}>
                            {label}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                  {trips.length > 3 && (
                    <span className="text-9 font-semibold" style={{ color: "#9a9fac" }}>
                      +{trips.length - 3} more
                    </span>
                  )}
                </>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ─── Ticket Sheet (bottom sheet, mobile + desktop) ────────────────────────────

function TicketSheet({
  trip,
  adultQty,
  childQty,
  onAdult,
  onChild,
  onClose,
  onAdd,
  termsUrl,
}: {
  trip: Trip;
  adultQty: number;
  childQty: number;
  onAdult: (n: number) => void;
  onChild: (n: number) => void;
  onClose: () => void;
  onAdd: () => void;
  termsUrl: string | null;
}) {
  const adultPrice = trip.product.prices.find((p) => p.ticketType === "adult");
  const childPrice = trip.product.prices.find((p) => p.ticketType === "child");
  const total = adultQty * (adultPrice?.priceCents ?? 0) + childQty * (childPrice?.priceCents ?? 0);
  const ticketCount = adultQty + childQty;

  useEffect(() => {
    document.body.style.overflow = "hidden";
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", handleKey);
    return () => {
      document.body.style.overflow = "";
      document.removeEventListener("keydown", handleKey);
    };
  }, [onClose]);

  return (
    <>
      <div
        className="fixed inset-0 bg-black/40 z-40 animate-fade-in"
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="ticket-sheet-title"
        className="fixed bottom-0 left-0 right-0 z-50 bg-white rounded-t-3xl shadow-2xl animate-slide-up max-h-[90dvh] flex flex-col md:left-auto md:right-0 md:top-[60px] md:bottom-0 md:w-[420px] md:rounded-none md:rounded-tl-3xl md:rounded-bl-3xl md:max-h-none md:shadow-[-8px_0_30px_rgba(0,0,0,0.08)]"
      >
        <div className="flex justify-center pt-3 pb-1 flex-shrink-0 md:hidden">
          <div className="w-10 h-1 rounded-pill bg-hairline" aria-hidden="true" />
        </div>
        <div className="hidden md:flex items-center justify-between px-5 py-4 border-b border-hairline flex-shrink-0">
          <div id="ticket-sheet-title" className="font-grotesk text-17 font-semibold text-navy">Select tickets</div>
          <button
            onClick={onClose}
            aria-label="Close ticket selection"
            className="w-8 h-8 rounded-pill hover:bg-fill flex items-center justify-center text-muted transition-colors"
          >
            <span aria-hidden="true">✕</span>
          </button>
        </div>

        <div className="overflow-y-auto flex-1 px-5">
          <div className="py-4 border-b border-hairline">
            <div className="flex items-center gap-2 mb-1">
              <div
                className="w-2 h-2 rounded-pill"
                style={{ backgroundColor: trip.vessel.color }}
              />
              <span className="text-12 font-bold uppercase tracking-wide text-gold">
                {trip.vessel.name}
              </span>
            </div>
            <div className="font-grotesk text-20 font-semibold text-navy">
              {trip.product.displayName}
            </div>
            <div className="text-13 text-muted mt-1">
              {fmtTimeET(trip.startTime)} – {fmtTimeET(trip.endTime)} ·{" "}
              {fmtDuration(trip.startTime, trip.endTime)}
            </div>
            <div className="text-12 text-success font-semibold mt-1.5">
              {trip.seatsRemaining} tickets available
            </div>
            <div className="text-12 text-muted mt-1.5">
              Weather cancellations receive a full refund.{" "}
              {termsUrl && (
                <a
                  href={termsUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline text-gold"
                >
                  View policy
                </a>
              )}
            </div>
          </div>
          <div className="py-4 space-y-5 pb-2">
            <div className="text-11 font-bold uppercase tracking-caps text-faint">
              Tickets
            </div>
            {adultPrice && (
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-15 font-semibold text-ink">Adult</div>
                  <div className="text-13 text-faint">
                    {dollars(adultPrice.priceCents)} · 13+
                  </div>
                </div>
                <Stepper value={adultQty} onChange={onAdult} max={trip.seatsRemaining - childQty} label="Adult" />
              </div>
            )}
            {childPrice && (
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-15 font-semibold text-ink">Child</div>
                  <div className="text-13 text-faint">
                    {dollars(childPrice.priceCents)} · 5–12
                  </div>
                </div>
                <Stepper value={childQty} onChange={onChild} max={trip.seatsRemaining - adultQty} label="Child" />
              </div>
            )}
          </div>
        </div>

        <div className="px-5 pt-3 pb-[max(1.5rem,env(safe-area-inset-bottom))] border-t border-hairline flex-shrink-0">
          {ticketCount > 0 && (
            <div className="flex justify-between items-baseline mb-3">
              <span className="text-14 text-muted">
                {ticketCount} ticket{ticketCount !== 1 ? "s" : ""}
              </span>
              <span className="font-grotesk text-22 font-bold text-ink">{dollars(total)}</span>
            </div>
          )}
          <button
            type="button"
            onClick={onAdd}
            disabled={ticketCount === 0}
            className="w-full py-4 rounded-btn font-grotesk text-15 font-bold transition-colors bg-gold text-navy hover:bg-gold-hover disabled:bg-disabled disabled:text-disabled-text"
          >
            {ticketCount === 0 ? "Select tickets" : "Add to cart"}
          </button>
        </div>
      </div>
    </>
  );
}

// ─── Step Indicator ───────────────────────────────────────────────────────────

function StepIndicator({ step }: { step: 1 | 2 | 3 }) {
  const steps = [
    { label: "Date", icon: <CalendarIcon size={14} /> },
    { label: "Tickets", icon: <TicketIcon /> },
    { label: "Checkout", icon: <CardIcon /> },
  ];
  return (
    <div className="px-5 pt-5 pb-4">
      <div className="flex items-center">
        {steps.map((s, i) => {
          const num = i + 1;
          const active = num === step;
          const done = num < step;
          return (
            <div key={s.label} className="flex items-center flex-1 last:flex-none">
              <div className="flex flex-col items-center gap-1">
                <div
                  className="w-8 h-8 rounded-full flex items-center justify-center transition-colors"
                  style={{
                    background: active || done ? "#c99a3f" : "#f1f4f3",
                    color: active || done ? "#182337" : "#9a9fac",
                  }}
                >
                  {done ? <CheckIcon /> : s.icon}
                </div>
                <span
                  className="text-10 font-semibold"
                  style={{ color: active ? "#c99a3f" : done ? "#c99a3f" : "#9a9fac" }}
                >
                  {s.label}
                </span>
              </div>
              {i < 2 && (
                <div
                  className="flex-1 h-px mx-2 mb-4"
                  style={{ background: num < step ? "rgba(201,154,63,0.4)" : "#ecefee" }}
                />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Desktop Right Sidebar ────────────────────────────────────────────────────

function DesktopSidebar({
  viewMode,
  selectedDay,
  dayTrips,
  totalCents,
  totalTickets,
  onTripSelect,
  onCheckout,
  tripQty,
}: {
  viewMode: ViewMode;
  selectedDay: string | null;
  dayTrips: Trip[];
  totalCents: number;
  totalTickets: number;
  onTripSelect: (t: Trip) => void;
  onCheckout: () => void;
  tripQty: (id: string) => number;
}) {
  const step: 1 | 2 | 3 = totalTickets > 0 ? 3 : selectedDay ? 2 : 1;
  return (
    <div className="hidden md:flex flex-col w-[360px] border-l border-hairline bg-white sticky top-[60px] h-[calc(100vh-60px)]">
      <StepIndicator step={step} />
      <div className="border-t border-hairline flex-shrink-0" />
      {viewMode === "calendar" ? (
        selectedDay ? (
          <>
            <div className="px-5 py-4 border-b border-hairline flex-shrink-0">
              <div className="text-11 font-bold uppercase tracking-caps text-faint mb-0.5">
                Trips
              </div>
              <div className="font-grotesk text-17 font-semibold text-ink">
                {fmtDayHeader(selectedDay)}
              </div>
            </div>
            <div className="flex-1 overflow-y-auto p-4 space-y-2">
              {dayTrips.length === 0 ? (
                <div className="text-center py-10 text-13 text-faint">No trips this day</div>
              ) : (
                dayTrips.map((t) => (
                  <TripRow
                    key={t.id}
                    trip={t}
                    cartQty={tripQty(t.id)}
                    onSelect={() => onTripSelect(t)}
                  />
                ))
              )}
            </div>
            {totalTickets > 0 && (
              <SidebarCartFooter
                totalCents={totalCents}
                totalTickets={totalTickets}
                onCheckout={onCheckout}
              />
            )}
          </>
        ) : (
          <div className="flex flex-col items-center justify-center flex-1 text-center px-8">
            <div className="w-11 h-11 rounded-[13px] bg-navy-tint flex items-center justify-center mb-3">
              <CalendarIcon size={22} />
            </div>
            <div className="font-grotesk text-15 font-semibold text-ink mb-1">
              Select a date
            </div>
            <div className="text-13 text-faint">Click a highlighted day to see trips</div>
            {totalTickets > 0 && (
              <SidebarCartFooter
                totalCents={totalCents}
                totalTickets={totalTickets}
                onCheckout={onCheckout}
              />
            )}
          </div>
        )
      ) : // List mode sidebar: cart summary
      totalTickets === 0 ? (
        <div className="flex flex-col items-center justify-center flex-1 text-center px-8">
          <div className="font-grotesk text-15 font-semibold text-ink mb-1">Your cart</div>
          <div className="text-13 text-faint">Select a trip to add tickets</div>
        </div>
      ) : (
        <SidebarCartFooter
          totalCents={totalCents}
          totalTickets={totalTickets}
          onCheckout={onCheckout}
        />
      )}
    </div>
  );
}

function SidebarCartFooter({
  totalCents,
  totalTickets,
  onCheckout,
}: {
  totalCents: number;
  totalTickets: number;
  onCheckout: () => void;
}) {
  return (
    <div className="border-t border-hairline p-5 flex-shrink-0">
      <div className="flex items-baseline justify-between mb-4">
        <div>
          <div
            className="text-12 font-bold uppercase mb-1"
            style={{ color: "#c99a3f", letterSpacing: "0.08em" }}
          >
            Total
          </div>
          <div className="font-manrope text-28 font-extrabold" style={{ color: "#1c2333" }}>
            {dollars(totalCents)}
          </div>
        </div>
        <div className="text-12" style={{ color: "#9a9fac" }}>
          {totalTickets} ticket{totalTickets !== 1 ? "s" : ""}
        </div>
      </div>
      <button
        type="button"
        onClick={onCheckout}
        className="w-full py-3.5 font-manrope text-14 font-bold transition-opacity hover:opacity-90 flex items-center justify-center gap-2"
        style={{ background: "#c99a3f", color: "#182337", borderRadius: "10px" }}
      >
        Checkout <ArrowRight />
      </button>
    </div>
  );
}

// ─── Mobile Cart Bar ──────────────────────────────────────────────────────────

function CartBar({
  totalCents,
  ticketCount,
  onCheckout,
}: {
  totalCents: number;
  ticketCount: number;
  onCheckout: () => void;
}) {
  if (ticketCount === 0) return null;
  return (
    <div className="fixed bottom-0 left-0 right-0 z-30 md:hidden bg-white/92 backdrop-blur-glass border-t border-hairline px-5 pt-3.5 pb-[max(1.5rem,env(safe-area-inset-bottom))] flex items-center justify-between">
      <div>
        <div className="font-grotesk text-22 font-bold text-ink">{dollars(totalCents)}</div>
        <div className="text-12 text-faint">
          {ticketCount} ticket{ticketCount !== 1 ? "s" : ""}
        </div>
      </div>
      <button
        type="button"
        onClick={onCheckout}
        className="flex items-center gap-2 px-6 py-3.5 rounded-btn bg-gold text-navy font-grotesk text-15 font-bold hover:bg-gold-hover transition-colors"
      >
        Checkout <ArrowRight />
      </button>
    </div>
  );
}

// ─── Main ────────────────────────────────────────────────────────────────────

export function BookingCalendar({
  initialTrips,
  initialMonth,
  operatorName,
  termsUrl,
}: {
  initialTrips: Trip[];
  initialMonth: string;
  operatorName: string;
  termsUrl: string | null;
}) {
  const [month, setMonth] = useState(initialMonth);
  const [trips, setTrips] = useState<Trip[]>(initialTrips);
  const [loading, setLoading] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>("list");
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const [cart, setCart] = useState<Map<string, number>>(new Map());
  const [sheetTripId, setSheetTripId] = useState<string | null>(null);
  const [sheetAdult, setSheetAdult] = useState(0);
  const [sheetChild, setSheetChild] = useState(0);
  const [tripTypeFilter, setTripTypeFilter] = useState<"all" | "half-day" | "full-day" | "weekend">("all");
  const [vesselFilter, setVesselFilter] = useState<string | null>(null);

  // Default to calendar view on desktop after hydration
  useEffect(() => {
    if (window.innerWidth >= 768) setViewMode("calendar");
    posthog.capture("list_view");
  }, []);

  // Restore cart from localStorage after hydration
  useEffect(() => {
    try {
      const raw = localStorage.getItem("openboat_cart");
      if (!raw) return;
      const items: EnrichedCartItem[] = JSON.parse(raw);
      const map = new Map<string, number>();
      items.forEach((item) => {
        item.tickets.forEach((t) => {
          map.set(`${item.tripId}:${t.ticketType}`, t.quantity);
        });
      });
      if (map.size > 0) setCart(map);
    } catch {
      /* ignore corrupt data */
    }
  }, []);

  // Persist cart to localStorage whenever it changes (enriched with trip data)
  useEffect(() => {
    if (cart.size === 0) {
      localStorage.removeItem("openboat_cart");
      return;
    }
    const tripIds = [...new Set([...cart.keys()].map((k) => k.split(":")[0]))];
    const items: EnrichedCartItem[] = tripIds.flatMap((tripId) => {
      const trip = trips.find((t) => t.id === tripId);
      if (!trip) return [];
      const adultQty = cart.get(`${tripId}:adult`) ?? 0;
      const childQty = cart.get(`${tripId}:child`) ?? 0;
      const adultPrice = trip.product.prices.find((p) => p.ticketType === "adult");
      const childPrice = trip.product.prices.find((p) => p.ticketType === "child");
      return [
        {
          tripId,
          departureDate: trip.departureDate,
          startTime: trip.startTime,
          endTime: trip.endTime,
          vesselName: trip.vessel.name,
          vesselColor: trip.vessel.color,
          category: trip.product.category,
          productName: trip.product.displayName,
          seatsRemaining: trip.seatsRemaining,
          tickets: [
            ...(adultQty > 0
              ? [
                  {
                    ticketType: "adult" as const,
                    quantity: adultQty,
                    priceCents: adultPrice?.priceCents ?? 0,
                  },
                ]
              : []),
            ...(childQty > 0
              ? [
                  {
                    ticketType: "child" as const,
                    quantity: childQty,
                    priceCents: childPrice?.priceCents ?? 0,
                  },
                ]
              : []),
          ],
        },
      ];
    });
    if (items.length > 0) localStorage.setItem("openboat_cart", JSON.stringify(items));
  }, [cart, trips]);

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

  const key = (tripId: string, type: "adult" | "child") => `${tripId}:${type}`;
  const getQty = (tripId: string, type: "adult" | "child") => cart.get(key(tripId, type)) ?? 0;
  const tripQty = (tripId: string) => getQty(tripId, "adult") + getQty(tripId, "child");
  const totalTickets = Array.from(cart.values()).reduce((a, b) => a + b, 0);
  const totalCents = trips.reduce((sum, t) => {
    const a = t.product.prices.find((p) => p.ticketType === "adult")?.priceCents ?? 0;
    const c = t.product.prices.find((p) => p.ticketType === "child")?.priceCents ?? 0;
    return sum + getQty(t.id, "adult") * a + getQty(t.id, "child") * c;
  }, 0);

  function openSheet(trip: Trip) {
    setSheetTripId(trip.id);
    setSheetAdult(getQty(trip.id, "adult") || 1);
    setSheetChild(getQty(trip.id, "child"));
    posthog.capture("sheet_open", {
      trip_id: trip.id,
      departure_date: trip.departureDate,
      vessel: trip.vessel.name,
      product: trip.product.displayName,
      seats_remaining: trip.seatsRemaining,
    });
  }
  function commitSheet() {
    if (!sheetTripId) return;
    const next = new Map(cart);
    sheetAdult > 0
      ? next.set(key(sheetTripId, "adult"), sheetAdult)
      : next.delete(key(sheetTripId, "adult"));
    sheetChild > 0
      ? next.set(key(sheetTripId, "child"), sheetChild)
      : next.delete(key(sheetTripId, "child"));
    setCart(next);
    setSheetTripId(null);
  }

  function goToCart() {
    window.location.href = "/checkout";
  }

  // Unique vessels for filter chips (derived from full trips, stable across filters)
  const uniqueVessels = [...new Map(trips.map((t) => [t.vessel.name, t.vessel])).values()];

  // Apply filters
  const filteredTrips = trips.filter((t) => {
    if (tripTypeFilter === "half-day" && tripDurationHours(t) >= 6) return false;
    if (tripTypeFilter === "full-day" && tripDurationHours(t) < 6) return false;
    if (tripTypeFilter === "weekend") {
      const dow = new Date(t.departureDate + "T12:00:00Z").getUTCDay();
      if (dow !== 0 && dow !== 6) return false;
    }
    if (vesselFilter && t.vessel.name !== vesselFilter) return false;
    return true;
  });

  const byDate = filteredTrips.reduce<Record<string, Trip[]>>((acc, t) => {
    (acc[t.departureDate] ??= []).push(t);
    return acc;
  }, {});
  const dates = Object.keys(byDate).sort();
  const dayTrips = selectedDay ? (byDate[selectedDay] ?? []) : [];
  const sheetTrip = sheetTripId ? (trips.find((t) => t.id === sheetTripId) ?? null) : null;

  return (
    <div className="min-h-screen bg-surface font-jakarta">
      {/* App bar */}
      <header
        className="sticky top-0 z-20 h-navbar flex items-center justify-between px-5"
        style={{ backgroundColor: "#14233d" }}
      >
        <div className="flex items-center gap-2.5">
          <AnchorIconSmall />
          <span className="font-grotesk text-17 font-semibold text-white">{operatorName}</span>
        </div>

        <div className="flex items-center gap-3">
          {/* View toggle — desktop only */}
          <div
            className="hidden md:flex items-center gap-0.5 rounded-icon p-0.5"
            style={{ background: "rgba(255,255,255,0.1)" }}
          >
            {(["list", "calendar"] as ViewMode[]).map((mode) => (
              <button
                key={mode}
                onClick={() => setViewMode(mode)}
                aria-pressed={viewMode === mode}
                className={`px-3 py-1.5 rounded-lg text-13 font-semibold transition-all capitalize ${
                  viewMode === mode ? "bg-white text-navy" : "text-white/50 hover:text-white/70"
                }`}
              >
                {mode}
              </button>
            ))}
          </div>

          {/* Month nav */}
          <div className="flex items-center gap-1.5">
            <button
              onClick={prevMonth}
              aria-label={`Previous month, ${MONTHS[mon - 2 < 0 ? 11 : mon - 2]} ${mon - 1 < 1 ? year - 1 : year}`}
              className="w-8 h-8 rounded-lg border border-white/20 flex items-center justify-center text-white/70 hover:text-white hover:border-white/40 transition-colors"
            >
              <ChevronLeft />
            </button>
            <span className="font-grotesk text-13 font-semibold text-white min-w-[90px] text-center" aria-live="polite">
              {MONTHS[mon - 1]} {year}
            </span>
            <button
              onClick={nextMonth}
              aria-label={`Next month, ${MONTHS[mon % 12]} ${mon === 12 ? year + 1 : year}`}
              className="w-8 h-8 rounded-lg border border-white/20 flex items-center justify-center text-white/70 hover:text-white hover:border-white/40 transition-colors"
            >
              <ChevronRight />
            </button>
          </div>
        </div>
      </header>

      {/* Filter chips bar */}
      <div className="bg-white border-b border-hairline px-4 py-2.5 flex items-center gap-2 overflow-x-auto no-scrollbar">
        {/* Trip type chips */}
        {(["all", "half-day", "full-day", "weekend"] as const).map((f) => {
          const label = { all: "All trips", "half-day": "Half-day", "full-day": "Full-day", weekend: "Weekend" }[f];
          const active = tripTypeFilter === f;
          return (
            <button
              key={f}
              onClick={() => setTripTypeFilter(f)}
              className="flex-shrink-0 px-3 py-1 rounded-full text-13 font-semibold transition-colors"
              style={
                active
                  ? { background: "#14233d", color: "#fff", border: "1px solid #14233d" }
                  : { background: "#fff", color: "#1c2333", border: "1px solid #d1d5db" }
              }
            >
              {label}
            </button>
          );
        })}

        {/* Divider */}
        {uniqueVessels.length > 1 && (
          <div className="w-px h-5 bg-hairline flex-shrink-0 mx-1" />
        )}

        {/* Vessel chips */}
        {uniqueVessels.length > 1 && uniqueVessels.map((v) => {
          const active = vesselFilter === v.name;
          return (
            <button
              key={v.name}
              onClick={() => setVesselFilter(active ? null : v.name)}
              className="flex-shrink-0 flex items-center gap-1.5 px-3 py-1 rounded-full text-13 font-semibold transition-colors"
              style={
                active
                  ? { background: "#14233d", color: "#fff", border: "1px solid #14233d" }
                  : { background: "#fff", color: "#1c2333", border: "1px solid #d1d5db" }
              }
            >
              <span
                className="w-2 h-2 rounded-full flex-shrink-0"
                style={{ backgroundColor: v.color }}
              />
              {v.name}
            </button>
          );
        })}
      </div>

      {/* Body: left content + right sidebar */}
      <div className="md:flex md:h-[calc(100vh-60px)]">
        {/* Left: list or calendar */}
        <div
          className={`flex-1 overflow-y-auto transition-opacity ${loading ? "opacity-40 pointer-events-none" : ""}`}
          aria-busy={loading}
        >
          {viewMode === "list" ? (
            <div className="max-w-2xl mx-auto px-4 py-5 pb-40 md:pb-8">
              {dates.length === 0 ? (
                <EmptyState />
              ) : (
                <div className="space-y-6">
                  {dates.map((date) => (
                    <div key={date}>
                      <div className="text-12 font-bold uppercase tracking-caps text-faint mb-2.5 px-1">
                        {fmtDayHeader(date)}
                      </div>
                      <div className="space-y-2">
                        {(byDate[date] ?? []).map((trip) => (
                          <TripRow
                            key={trip.id}
                            trip={trip}
                            cartQty={tripQty(trip.id)}
                            onSelect={() => openSheet(trip)}
                          />
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <div className="px-5 py-5">
              {dates.length === 0 ? (
                <EmptyState />
              ) : (
                <MonthGrid
                  month={month}
                  byDate={byDate}
                  selectedDay={selectedDay}
                  onDaySelect={setSelectedDay}
                />
              )}
            </div>
          )}
        </div>

        {/* Right sidebar — desktop */}
        <DesktopSidebar
          viewMode={viewMode}
          selectedDay={selectedDay}
          dayTrips={dayTrips}
          totalCents={totalCents}
          totalTickets={totalTickets}
          onTripSelect={openSheet}
          onCheckout={goToCart}
          tripQty={tripQty}
        />
      </div>

      {/* Ticket sheet */}
      {sheetTrip && (
        <TicketSheet
          trip={sheetTrip}
          adultQty={sheetAdult}
          childQty={sheetChild}
          onAdult={setSheetAdult}
          onChild={setSheetChild}
          onClose={() => setSheetTripId(null)}
          onAdd={commitSheet}
          termsUrl={termsUrl}
        />
      )}

      {/* Mobile cart bar */}
      <CartBar totalCents={totalCents} ticketCount={totalTickets} onCheckout={goToCart} />
    </div>
  );
}

// ─── Small pieces ─────────────────────────────────────────────────────────────

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center py-24 text-center">
      <div className="w-12 h-12 rounded-[14px] bg-navy-tint flex items-center justify-center mb-3">
        <CalendarIcon />
      </div>
      <div className="font-grotesk text-16 font-semibold text-ink mb-1">
        No trips this month
      </div>
      <div className="text-13 text-faint">Try the next month →</div>
    </div>
  );
}

// ─── Icons ────────────────────────────────────────────────────────────────────

function AnchorIconSmall() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="#C9922A"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="5" r="3" />
      <line x1="12" y1="22" x2="12" y2="8" />
      <path d="M5 12H2a10 10 0 0 0 20 0h-3" />
    </svg>
  );
}
function ChevronLeft() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="m15 18-6-6 6-6" />
    </svg>
  );
}
function ChevronRight() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="m9 18 6-6-6-6" />
    </svg>
  );
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
function CalendarIcon({ size = 22 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect width="18" height="18" x="3" y="4" rx="2" />
      <line x1="16" x2="16" y1="2" y2="6" />
      <line x1="8" x2="8" y1="2" y2="6" />
      <line x1="3" x2="21" y1="10" y2="10" />
    </svg>
  );
}
function TicketIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M2 9a3 3 0 0 1 0 6v2a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-2a3 3 0 0 1 0-6V7a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2Z"/>
    </svg>
  );
}
function CardIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect width="20" height="14" x="2" y="5" rx="2"/>
      <line x1="2" x2="22" y1="10" y2="10"/>
    </svg>
  );
}
function CheckIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polyline points="20 6 9 17 4 12"/>
    </svg>
  );
}
