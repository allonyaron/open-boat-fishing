"use client";

import { useState, useEffect } from "react";
import posthog from "posthog-js";

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
  "January","February","March","April","May","June",
  "July","August","September","October","November","December",
];
const DAYS_SHORT = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];

function toMonthStr(year: number, mon: number) {
  return `${year}-${String(mon).padStart(2, "0")}`;
}
function parseMonth(month: string) {
  const [y, m] = month.split("-").map(Number);
  return { year: y, mon: m };
}
function fmtTime(iso: string | Date) {
  return new Date(iso).toLocaleTimeString("en-US", {
    hour: "numeric", minute: "2-digit", timeZone: "America/New_York",
  });
}
function fmtDayHeader(dateStr: string) {
  return new Date(dateStr + "T12:00:00Z").toLocaleDateString("en-US", {
    weekday: "long", month: "long", day: "numeric",
  });
}
function dollars(cents: number) {
  const n = cents / 100;
  return `$${Number.isInteger(n) ? n : n.toFixed(2)}`;
}
function fmtDuration(startIso: string, endIso: string) {
  const diffMs = new Date(endIso).getTime() - new Date(startIso).getTime();
  const totalMins = Math.round(diffMs / 60000);
  const hrs = Math.floor(totalMins / 60);
  const mins = totalMins % 60;
  return mins === 0 ? `${hrs} hr` : `${hrs} hr ${mins} min`;
}

// ─── Stepper ──────────────────────────────────────────────────────────────────

function Stepper({ value, onChange, max }: { value: number; onChange: (n: number) => void; max: number }) {
  return (
    <div className="flex items-center gap-3">
      <button type="button" onClick={() => onChange(Math.max(0, value - 1))} disabled={value === 0}
        className={`w-9 h-9 rounded-pill flex items-center justify-center text-lg transition-colors ${
          value === 0 ? "border border-hairline text-disabled-text cursor-default" : "border-[1.5px] border-gold text-gold"
        }`}>−</button>
      <span className="font-grotesk text-[17px] font-semibold w-5 text-center">{value}</span>
      <button type="button" onClick={() => onChange(Math.min(max, value + 1))} disabled={value >= max}
        className="w-9 h-9 rounded-pill bg-navy text-white flex items-center justify-center text-lg hover:bg-navy-medium transition-colors disabled:bg-disabled disabled:text-disabled-text">+</button>
    </div>
  );
}

// ─── Trip Row ─────────────────────────────────────────────────────────────────

function TripRow({ trip, cartQty, onSelect }: { trip: Trip; cartQty: number; onSelect: () => void }) {
  const soldOut = trip.seatsRemaining === 0;
  const seats = trip.seatsRemaining;
  const threshold40 = Math.round(trip.capacity * 0.4);
  const fromPrice = trip.product.prices.length > 0
    ? Math.min(...trip.product.prices.map((p) => p.priceCents))
    : null;

  let badge: React.ReactNode = null;
  if (soldOut) {
    badge = <span className="text-[11px] font-semibold text-warning bg-warning-bg px-2 py-0.5 rounded-pill">Sold out</span>;
  } else if (seats <= 3) {
    badge = <span className="text-[11px] font-semibold text-warning bg-warning-bg px-2 py-0.5 rounded-pill">{seats} left</span>;
  } else if (seats <= threshold40) {
    badge = <span className="text-[11px] font-semibold text-faint bg-fill px-2 py-0.5 rounded-pill">{seats} seats left</span>;
  } else {
    badge = <span className="text-[11px] font-semibold text-success bg-success-bg px-2 py-0.5 rounded-pill">{seats} seats left</span>;
  }

  return (
    <button type="button" onClick={onSelect} disabled={soldOut}
      className={`w-full text-left flex items-center gap-3 p-4 bg-white rounded-[16px] border transition-all ${
        soldOut ? "border-hairline opacity-60 cursor-not-allowed"
        : cartQty > 0 ? "border-gold shadow-card-selected"
        : "border-card-border shadow-card hover:border-gold/40"
      }`}>
      <div className="w-1 self-stretch rounded-pill flex-shrink-0" style={{ backgroundColor: trip.vessel.color }} />
      <div className="flex-1 min-w-0">
        <div className="text-[11px] font-bold uppercase tracking-wide text-gold mb-0.5">{trip.product.category}</div>
        <div className="font-grotesk text-[15px] font-bold text-navy truncate">{trip.product.displayName}</div>
        <div className="text-[13px] text-muted mt-0.5">
          {trip.vessel.name} · {fmtTime(trip.startTime)} – {fmtTime(trip.endTime)} · {fmtDuration(trip.startTime, trip.endTime)}
        </div>
        {fromPrice !== null && (
          <div className="text-[13px] text-ink font-semibold mt-0.5">from {dollars(fromPrice)}</div>
        )}
      </div>
      <div className="flex flex-col items-end gap-1.5 flex-shrink-0">
        {cartQty > 0 && <span className="text-[11px] font-bold text-gold bg-gold/10 border border-gold/30 px-2 py-0.5 rounded-pill">{cartQty} in cart</span>}
        {badge}
        <ChevronRight />
      </div>
    </button>
  );
}

// ─── Month Grid (desktop calendar view) ───────────────────────────────────────

function MonthGrid({
  month, byDate, selectedDay, onDaySelect,
}: {
  month: string; byDate: Record<string, Trip[]>; selectedDay: string | null; onDaySelect: (d: string) => void;
}) {
  const { year, mon } = parseMonth(month);
  const firstDow = new Date(Date.UTC(year, mon - 1, 1)).getUTCDay();
  const lastDay = new Date(Date.UTC(year, mon, 0)).getUTCDate();
  const today = new Date().toISOString().slice(0, 10);

  const days = Array.from({ length: lastDay }, (_, i) =>
    `${month}-${String(i + 1).padStart(2, "0")}`
  );
  const cells: (string | null)[] = [...Array(firstDow).fill(null), ...days];
  while (cells.length % 7 !== 0) cells.push(null);

  return (
    <div>
      <div className="grid grid-cols-7 mb-2">
        {DAYS_SHORT.map((d) => (
          <div key={d} className="text-center text-[11px] font-bold text-faint uppercase py-2">{d}</div>
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

          return (
            <button
              key={date}
              onClick={() => hasTrips && onDaySelect(date)}
              disabled={!hasTrips}
              className={`min-h-[80px] rounded-[14px] p-2.5 text-left transition-all ${
                isSelected
                  ? "bg-navy shadow-day-selected"
                  : hasTrips
                  ? "bg-white border border-card-border hover:border-gold/50 shadow-card cursor-pointer"
                  : "bg-fill/60 border border-hairline cursor-default"
              } ${isToday && !isSelected ? "ring-2 ring-gold/40" : ""}`}
            >
              <div className={`font-grotesk text-[14px] font-semibold mb-2 ${
                isSelected ? "text-white" : hasTrips ? "text-ink" : "text-faint"
              }`}>{dayNum}</div>
              {hasTrips && (
                <div className="flex flex-wrap gap-[3px]">
                  {trips.slice(0, 5).map((t, j) => (
                    <div key={j} className="w-[7px] h-[7px] rounded-pill"
                      style={{ backgroundColor: isSelected ? "rgba(255,255,255,0.65)" : "#C9922A" }} />
                  ))}
                  {trips.length > 5 && (
                    <span className={`text-[9px] font-bold leading-[7px] ${isSelected ? "text-white/65" : "text-faint"}`}>
                      +{trips.length - 5}
                    </span>
                  )}
                </div>
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
  trip, adultQty, childQty, onAdult, onChild, onClose, onAdd, termsUrl,
}: {
  trip: Trip; adultQty: number; childQty: number;
  onAdult: (n: number) => void; onChild: (n: number) => void;
  onClose: () => void; onAdd: () => void; termsUrl: string | null;
}) {
  const adultPrice = trip.product.prices.find((p) => p.ticketType === "adult");
  const childPrice = trip.product.prices.find((p) => p.ticketType === "child");
  const total = (adultQty * (adultPrice?.priceCents ?? 0)) + (childQty * (childPrice?.priceCents ?? 0));
  const ticketCount = adultQty + childQty;

  useEffect(() => {
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = ""; };
  }, []);

  return (
    <>
      <div className="fixed inset-0 bg-black/40 z-40 animate-fade-in" onClick={onClose} />
      <div className="fixed bottom-0 left-0 right-0 z-50 bg-white rounded-t-[24px] shadow-2xl animate-slide-up max-h-[90dvh] flex flex-col md:left-auto md:right-0 md:top-[60px] md:bottom-0 md:w-[420px] md:rounded-none md:rounded-tl-[24px] md:rounded-bl-[24px] md:max-h-none md:shadow-[-8px_0_30px_rgba(0,0,0,0.08)]">
        <div className="flex justify-center pt-3 pb-1 flex-shrink-0 md:hidden">
          <div className="w-10 h-1 rounded-pill bg-hairline" />
        </div>
        <div className="hidden md:flex items-center justify-between px-5 py-4 border-b border-hairline flex-shrink-0">
          <div className="font-grotesk text-[17px] font-semibold text-navy">Select tickets</div>
          <button onClick={onClose} className="w-8 h-8 rounded-pill hover:bg-fill flex items-center justify-center text-muted transition-colors">✕</button>
        </div>

        <div className="overflow-y-auto flex-1 px-5">
          <div className="py-4 border-b border-hairline">
            <div className="flex items-center gap-2 mb-1">
              <div className="w-2 h-2 rounded-pill" style={{ backgroundColor: trip.vessel.color }} />
              <span className="text-[12px] font-bold uppercase tracking-wide text-gold">{trip.vessel.name}</span>
            </div>
            <div className="font-grotesk text-[20px] font-semibold text-navy">{trip.product.displayName}</div>
            <div className="text-[13px] text-muted mt-1">
              {fmtTime(trip.startTime)} – {fmtTime(trip.endTime)} · {fmtDuration(trip.startTime, trip.endTime)}
            </div>
            <div className="text-[12px] text-success font-semibold mt-1.5">{trip.seatsRemaining} tickets available</div>
            <div className="text-[12px] text-muted mt-1.5">
              Weather cancellations receive a full refund.{" "}
              {termsUrl && <a href={termsUrl} target="_blank" rel="noopener noreferrer" className="underline text-gold">View policy</a>}
            </div>
          </div>
          <div className="py-4 space-y-5 pb-2">
            <div className="text-[11px] font-bold uppercase tracking-[0.1em] text-faint">Tickets</div>
            {adultPrice && (
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-[15px] font-semibold text-ink">Adult</div>
                  <div className="text-[13px] text-faint">{dollars(adultPrice.priceCents)} · 13+</div>
                </div>
                <Stepper value={adultQty} onChange={onAdult} max={trip.seatsRemaining - childQty} />
              </div>
            )}
            {childPrice && (
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-[15px] font-semibold text-ink">Child</div>
                  <div className="text-[13px] text-faint">{dollars(childPrice.priceCents)} · 5–12</div>
                </div>
                <Stepper value={childQty} onChange={onChild} max={trip.seatsRemaining - adultQty} />
              </div>
            )}
          </div>
        </div>

        <div className="px-5 pt-3 pb-[max(1.5rem,env(safe-area-inset-bottom))] border-t border-hairline flex-shrink-0">
          {ticketCount > 0 && (
            <div className="flex justify-between items-baseline mb-3">
              <span className="text-[14px] text-muted">{ticketCount} ticket{ticketCount !== 1 ? "s" : ""}</span>
              <span className="font-grotesk text-[22px] font-bold text-ink">{dollars(total)}</span>
            </div>
          )}
          <button type="button" onClick={onAdd} disabled={ticketCount === 0}
            className="w-full py-4 rounded-btn font-grotesk text-[15px] font-bold transition-colors bg-gold text-navy hover:bg-gold-hover disabled:bg-disabled disabled:text-disabled-text">
            {ticketCount === 0 ? "Select tickets" : "Add to cart"}
          </button>
        </div>
      </div>
    </>
  );
}

// ─── Desktop Right Sidebar ────────────────────────────────────────────────────

function DesktopSidebar({
  viewMode, selectedDay, dayTrips, totalCents, totalTickets,
  onTripSelect, onCheckout, tripQty,
}: {
  viewMode: ViewMode; selectedDay: string | null; dayTrips: Trip[];
  totalCents: number; totalTickets: number;
  onTripSelect: (t: Trip) => void; onCheckout: () => void;
  tripQty: (id: string) => number;
}) {
  return (
    <div className="hidden md:flex flex-col w-[360px] border-l border-hairline bg-white sticky top-[60px] h-[calc(100vh-60px)]">
      {viewMode === "calendar" ? (
        selectedDay ? (
          <>
            <div className="px-5 py-4 border-b border-hairline flex-shrink-0">
              <div className="text-[11px] font-bold uppercase tracking-[0.1em] text-faint mb-0.5">Trips</div>
              <div className="font-grotesk text-[17px] font-semibold text-ink">{fmtDayHeader(selectedDay)}</div>
            </div>
            <div className="flex-1 overflow-y-auto p-4 space-y-2">
              {dayTrips.length === 0
                ? <div className="text-center py-10 text-[13px] text-faint">No trips this day</div>
                : dayTrips.map((t) => (
                    <TripRow key={t.id} trip={t} cartQty={tripQty(t.id)} onSelect={() => onTripSelect(t)} />
                  ))}
            </div>
            {totalTickets > 0 && <SidebarCartFooter totalCents={totalCents} totalTickets={totalTickets} onCheckout={onCheckout} />}
          </>
        ) : (
          <div className="flex flex-col items-center justify-center flex-1 text-center px-8">
            <div className="w-11 h-11 rounded-[13px] bg-navy-tint flex items-center justify-center mb-3">
              <CalendarIcon />
            </div>
            <div className="font-grotesk text-[15px] font-semibold text-ink mb-1">Select a date</div>
            <div className="text-[13px] text-faint">Click a highlighted day to see trips</div>
            {totalTickets > 0 && <SidebarCartFooter totalCents={totalCents} totalTickets={totalTickets} onCheckout={onCheckout} />}
          </div>
        )
      ) : (
        // List mode sidebar: cart summary
        totalTickets === 0 ? (
          <div className="flex flex-col items-center justify-center flex-1 text-center px-8">
            <div className="font-grotesk text-[15px] font-semibold text-ink mb-1">Your cart</div>
            <div className="text-[13px] text-faint">Select a trip to add tickets</div>
          </div>
        ) : (
          <SidebarCartFooter totalCents={totalCents} totalTickets={totalTickets} onCheckout={onCheckout} />
        )
      )}
    </div>
  );
}

function SidebarCartFooter({ totalCents, totalTickets, onCheckout }: { totalCents: number; totalTickets: number; onCheckout: () => void }) {
  return (
    <div className="border-t border-hairline p-5 flex-shrink-0">
      <div className="flex items-center justify-between mb-4">
        <div>
          <div className="text-[12px] font-bold uppercase tracking-wide text-gold mb-0.5">Total</div>
          <div className="font-grotesk text-[24px] font-bold text-ink">{dollars(totalCents)}</div>
        </div>
        <div className="text-[13px] text-muted">{totalTickets} ticket{totalTickets !== 1 ? "s" : ""}</div>
      </div>
      <button type="button" onClick={onCheckout}
        className="w-full py-4 rounded-btn bg-gold text-navy font-grotesk text-[15px] font-bold hover:bg-gold-hover transition-colors flex items-center justify-center gap-2">
        Checkout <ArrowRight />
      </button>
    </div>
  );
}

// ─── Mobile Cart Bar ──────────────────────────────────────────────────────────

function CartBar({ totalCents, ticketCount, onCheckout }: { totalCents: number; ticketCount: number; onCheckout: () => void }) {
  if (ticketCount === 0) return null;
  return (
    <div className="fixed bottom-0 left-0 right-0 z-30 md:hidden bg-white/92 backdrop-blur-[14px] border-t border-hairline px-5 pt-3.5 pb-[max(1.5rem,env(safe-area-inset-bottom))] flex items-center justify-between">
      <div>
        <div className="font-grotesk text-[22px] font-bold text-ink">{dollars(totalCents)}</div>
        <div className="text-[12px] text-faint">{ticketCount} ticket{ticketCount !== 1 ? "s" : ""}</div>
      </div>
      <button type="button" onClick={onCheckout}
        className="flex items-center gap-2 px-6 py-3.5 rounded-btn bg-gold text-navy font-grotesk text-[15px] font-bold hover:bg-gold-hover transition-colors">
        Checkout <ArrowRight />
      </button>
    </div>
  );
}

// ─── Main ────────────────────────────────────────────────────────────────────

export function BookingCalendar({ initialTrips, initialMonth, operatorName, termsUrl }: { initialTrips: Trip[]; initialMonth: string; operatorName: string; termsUrl: string | null }) {
  const [month, setMonth] = useState(initialMonth);
  const [trips, setTrips] = useState<Trip[]>(initialTrips);
  const [loading, setLoading] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>("list");
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const [cart, setCart] = useState<Map<string, number>>(new Map());
  const [sheetTripId, setSheetTripId] = useState<string | null>(null);
  const [sheetAdult, setSheetAdult] = useState(0);
  const [sheetChild, setSheetChild] = useState(0);

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
    } catch { /* ignore corrupt data */ }
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
      return [{
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
          ...(adultQty > 0 ? [{ ticketType: "adult" as const, quantity: adultQty, priceCents: adultPrice?.priceCents ?? 0 }] : []),
          ...(childQty > 0 ? [{ ticketType: "child" as const, quantity: childQty, priceCents: childPrice?.priceCents ?? 0 }] : []),
        ],
      }];
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
    sheetAdult > 0 ? next.set(key(sheetTripId, "adult"), sheetAdult) : next.delete(key(sheetTripId, "adult"));
    sheetChild > 0 ? next.set(key(sheetTripId, "child"), sheetChild) : next.delete(key(sheetTripId, "child"));
    setCart(next);
    setSheetTripId(null);
  }

  function goToCart() {
    window.location.href = "/checkout";
  }

  const byDate = trips.reduce<Record<string, Trip[]>>((acc, t) => {
    (acc[t.departureDate] ??= []).push(t);
    return acc;
  }, {});
  const dates = Object.keys(byDate).sort();
  const dayTrips = selectedDay ? (byDate[selectedDay] ?? []) : [];
  const sheetTrip = sheetTripId ? trips.find((t) => t.id === sheetTripId) ?? null : null;

  return (
    <div className="min-h-screen bg-surface font-jakarta">
      {/* App bar */}
      <header className="sticky top-0 z-20 h-[60px] flex items-center justify-between px-5" style={{ backgroundColor: "#0D1B2A" }}>
        <div className="flex items-center gap-2.5">
          <AnchorIconSmall />
          <span className="font-grotesk text-[17px] font-semibold text-white">{operatorName}</span>
        </div>

        <div className="flex items-center gap-3">
          {/* View toggle — desktop only */}
          <div className="hidden md:flex items-center gap-0.5 rounded-[10px] p-0.5" style={{ background: "rgba(255,255,255,0.1)" }}>
            {(["list", "calendar"] as ViewMode[]).map((mode) => (
              <button
                key={mode}
                onClick={() => setViewMode(mode)}
                className={`px-3 py-1.5 rounded-[8px] text-[13px] font-semibold transition-all capitalize ${
                  viewMode === mode
                    ? "bg-white/20 text-white"
                    : "text-white/50 hover:text-white/70"
                }`}
              >
                {mode}
              </button>
            ))}
          </div>

          {/* Month nav */}
          <div className="flex items-center gap-1.5">
            <button onClick={prevMonth} className="w-8 h-8 rounded-[8px] border border-white/20 flex items-center justify-center text-white/70 hover:text-white hover:border-white/40 transition-colors">
              <ChevronLeft />
            </button>
            <span className="font-grotesk text-[13px] font-semibold text-white min-w-[90px] text-center">
              {MONTHS[mon - 1]} {year}
            </span>
            <button onClick={nextMonth} className="w-8 h-8 rounded-[8px] border border-white/20 flex items-center justify-center text-white/70 hover:text-white hover:border-white/40 transition-colors">
              <ChevronRight />
            </button>
          </div>
        </div>
      </header>

      {/* Body: left content + right sidebar */}
      <div className="md:flex md:h-[calc(100vh-60px)]">

        {/* Left: list or calendar */}
        <div className={`flex-1 overflow-y-auto transition-opacity ${loading ? "opacity-40 pointer-events-none" : ""}`}>
          {viewMode === "list" ? (
            <div className="max-w-2xl mx-auto px-4 py-5 pb-40 md:pb-8">
              {dates.length === 0 ? (
                <EmptyState />
              ) : (
                <div className="space-y-6">
                  {dates.map((date) => (
                    <div key={date}>
                      <div className="text-[12px] font-bold uppercase tracking-[0.1em] text-faint mb-2.5 px-1">
                        {fmtDayHeader(date)}
                      </div>
                      <div className="space-y-2">
                        {(byDate[date] ?? []).map((trip) => (
                          <TripRow key={trip.id} trip={trip} cartQty={tripQty(trip.id)} onSelect={() => openSheet(trip)} />
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <div className="px-5 py-5">
              {dates.length === 0 ? <EmptyState /> : (
                <MonthGrid month={month} byDate={byDate} selectedDay={selectedDay} onDaySelect={setSelectedDay} />
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
      <div className="font-grotesk text-[16px] font-semibold text-ink mb-1">No trips this month</div>
      <div className="text-[13px] text-faint">Try the next month →</div>
    </div>
  );
}

// ─── Icons ────────────────────────────────────────────────────────────────────

function AnchorIconSmall() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#C9922A" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="5" r="3"/><line x1="12" y1="22" x2="12" y2="8"/><path d="M5 12H2a10 10 0 0 0 20 0h-3"/>
    </svg>
  );
}
function ChevronLeft() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="m15 18-6-6 6-6"/>
    </svg>
  );
}
function ChevronRight() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="m9 18 6-6-6-6"/>
    </svg>
  );
}
function ArrowRight() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M5 12h14"/><path d="m12 5 7 7-7 7"/>
    </svg>
  );
}
function CalendarIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#C9922A" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect width="18" height="18" x="3" y="4" rx="2"/><line x1="16" x2="16" y1="2" y2="6"/><line x1="8" x2="8" y1="2" y2="6"/><line x1="3" x2="21" y1="10" y2="10"/>
    </svg>
  );
}
