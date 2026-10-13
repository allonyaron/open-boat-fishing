"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import posthog from "posthog-js";
import { BookingNav } from "./BookingNav";
import { CartRail } from "./CartRail";
import { DayGroup } from "./DayGroup";
import { DayPanel } from "./DayPanel";
import { EmptyState } from "./EmptyState";
import { FilterBar } from "./FilterBar";
import { MobileCartBar } from "./MobileCartBar";
import { MobilePanelCalendar } from "./MobilePanelCalendar";
import { MonthCalendar } from "./MonthCalendar";
import { parseMonth, toMonthStr, todayET } from "./format";
import { useCart } from "./useCart";
import { quoteView } from "@/lib/cart/quote-view";
import type { Trip, VesselInfo } from "./types";

export { BookingNav } from "./BookingNav";
export type { EnrichedCartItem, Trip } from "./types";

/** The desktop day panel: which day, and which trip to bring forward. */
type PanelState = {
  date: string;
  tripId: string | null;
  /** False when opened by the page itself (a deep link), so focus stays put. */
  moveFocus: boolean;
  seq: number;
};

function groupByDate(trips: Trip[]) {
  return trips.reduce<Record<string, Trip[]>>((acc, t) => {
    (acc[t.departureDate] ??= []).push(t);
    return acc;
  }, {});
}

function filterTrips(trips: Trip[], vesselFilter: string) {
  return vesselFilter === "all" ? trips : trips.filter((t) => t.vessel.name === vesselFilter);
}

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
  // A deep link (?date=, from the home page) opens that day's panel on desktop.
  const [panel, setPanel] = useState<PanelState | null>(() =>
    initialDate && initialTrips.some((t) => t.departureDate === initialDate)
      ? {
          date: initialDate,
          tripId: initialTrips.some((t) => t.id === initialTripId) ? initialTripId! : null,
          moveFocus: false,
          seq: 0,
        }
      : null,
  );
  // The panel is placed by measuring the grid, so it renders after hydration.
  const [mounted, setMounted] = useState(false);

  const announceRef = useRef<HTMLDivElement>(null);
  const headerRef = useRef<HTMLDivElement>(null);
  const calBodyRef = useRef<HTMLDivElement>(null);

  const openPanel = useCallback((date: string, tripId: string | null, moveFocus: boolean) => {
    setPanel((p) => ({ date, tripId, moveFocus, seq: (p?.seq ?? 0) + 1 }));
  }, []);

  const onInitialTripPreAdded = useCallback(
    (departureDate: string) => {
      setSelectedDay(departureDate);
      setPanel((p) => p ?? { date: departureDate, tripId: initialTripId ?? null, moveFocus: false, seq: 1 });
    },
    [initialTripId],
  );

  const {
    cartItems,
    getQty,
    adjustQty,
    removeFromCart,
    quote,
    totalSeats,
    ready,
  } = useCart({ trips, initialTripId, initialTrips, onInitialTripPreAdded });

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

  useEffect(() => {
    posthog.capture("booking_view");
    setMounted(true);
  }, []);

  const shownQuote = quoteView(quote);
  const { year, mon } = parseMonth(month);

  async function goToMonth(m: string): Promise<Trip[]> {
    setLoading(true);
    setPanel(null);
    const data: Trip[] = await fetch(`/api/trips?month=${m}`).then((r) => r.json());
    setTrips(data);
    setMonth(m);
    setSelectedDay(null);
    setLoading(false);
    return data;
  }
  function prevMonth() {
    const d = new Date(Date.UTC(year, mon - 2, 1));
    goToMonth(toMonthStr(d.getUTCFullYear(), d.getUTCMonth() + 1));
  }
  function nextMonth() {
    const d = new Date(Date.UTC(year, mon, 1));
    goToMonth(toMonthStr(d.getUTCFullYear(), d.getUTCMonth() + 1));
  }

  function handleRemove(tripId: string) {
    const removed = removeFromCart(tripId);
    if (announceRef.current) {
      announceRef.current.textContent = `${removed?.productName ?? "Trip"} removed`;
    }
  }

  // Mobile: tapping a day in the month card scrolls the list to it.
  function handleDaySelect(date: string) {
    setSelectedDay(date);
    const dayNum = parseInt(date.slice(-2));
    const el = document.getElementById(`day-${dayNum}`);
    if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  // Desktop: a cart item's date line opens its day, switching month (and
  // clearing a boat filter that hides the trip) if needed.
  async function openDayFromCart(date: string, tripId: string) {
    let listed = trips;
    if (date.slice(0, 7) !== month) listed = await goToMonth(date.slice(0, 7));
    const trip = listed.find((t) => t.id === tripId);
    if (!trip) return; // no longer on sale
    if (vesselFilter !== "all" && trip.vessel.name !== vesselFilter) setVesselFilter("all");
    openPanel(date, tripId, true);
  }

  function changeFilter(f: string) {
    setVesselFilter(f);
    // The open day stays open if it still has trips for this boat.
    if (panel && !filterTrips(trips, f).some((t) => t.departureDate === panel.date)) setPanel(null);
  }

  // Closing returns focus to the day's box.
  const panelDate = panel?.date;
  const closePanel = useCallback(() => {
    setPanel(null);
    if (!panelDate) return;
    requestAnimationFrame(() =>
      calBodyRef.current
        ?.querySelector<HTMLButtonElement>(`button[data-day-hit="${panelDate}"]`)
        ?.focus({ preventScroll: true }),
    );
  }, [panelDate]);

  // Esc, or a click outside the panel and the rail, closes the panel. Clicks
  // on another day swap it; clicks in the header (the boat filter) keep it.
  useEffect(() => {
    if (!panel) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        closePanel();
      }
    }
    function onPointerDown(e: PointerEvent) {
      const t = e.target as Element | null;
      if (!t?.closest) return;
      if (
        t.closest("[data-day-panel]") ||
        t.closest(".booking-rail") ||
        t.closest("[data-booking-header]") ||
        t.closest("[data-day-hit]") ||
        t.closest(".bk-lines")
      )
        return;
      closePanel();
    }
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPointerDown);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPointerDown);
    };
  }, [panel, closePanel]);

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

  const filteredTrips = filterTrips(trips, vesselFilter);
  const byDate = groupByDate(filteredTrips);
  const dates = Object.keys(byDate).sort();
  const cartDates = new Set(cartItems.map((i) => i.departureDate));
  const cartTripIds = new Set(cartItems.map((i) => i.tripId));
  const todayStr = todayET();
  const sailingDays = dates.filter((d) => d >= todayStr);
  const currentMonth = toMonthStr(new Date().getUTCFullYear(), new Date().getUTCMonth() + 1);
  const panelTrips = panel
    ? [...(byDate[panel.date] ?? [])].sort((a, b) => a.startTime.localeCompare(b.startTime))
    : [];

  return (
    <div className="booking-app bg-deck font-archivo">
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

      <div ref={headerRef} data-booking-header style={{ position: "sticky", top: 0, zIndex: 50 }}>
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
          onFilterChange={changeFilter}
        />
      </div>

      {/* Mobile month card — above trip list, hidden on desktop */}
      <div className="lg:hidden">
        <MobilePanelCalendar
          month={month}
          byDate={byDate}
          selectedDay={selectedDay}
          cartDates={cartDates}
          canPrevMonth={month > currentMonth}
          canNextMonth={true}
          onDaySelect={handleDaySelect}
          onPrevMonth={prevMonth}
          onNextMonth={nextMonth}
        />
      </div>

      <div className="booking-shell">
        <div className="booking-main">
          {/* Desktop: the month calendar fills the column; the footer follows it */}
          <div className="booking-main-cal hidden lg:block">
            <MonthCalendar
              month={month}
              byDate={byDate}
              sailingDays={sailingDays}
              todayStr={todayStr}
              cartTripIds={cartTripIds}
              openDate={panel?.date ?? null}
              canPrevMonth={month > currentMonth}
              loading={loading}
              bodyRef={calBodyRef}
              onPrevMonth={prevMonth}
              onNextMonth={nextMonth}
              onOpenDay={(date, tripId) => openPanel(date, tripId ?? null, true)}
            >
              {mounted && panel && panelTrips.length > 0 && (
                <DayPanel
                  date={panel.date}
                  trips={panelTrips}
                  sailingDays={sailingDays}
                  focusTripId={panel.tripId}
                  focusSeq={panel.seq}
                  moveFocus={panel.moveFocus}
                  bodyRef={calBodyRef}
                  getQty={getQty}
                  onAdjustQty={adjustQty}
                  onNavigate={(date) => openPanel(date, null, false)}
                  onClose={closePanel}
                />
              )}
            </MonthCalendar>
          </div>

          {/* Mobile: trip list */}
          <div
            className={`booking-list-col lg:hidden transition-opacity ${
              loading ? "opacity-40 pointer-events-none" : ""
            }`}
            aria-busy={loading}
            style={{ padding: "8px 24px 220px" }}
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

          <BookingFooter className="hidden lg:flex" />
        </div>

        {/* Right: cart rail */}
        <CartRail
          cartItems={cartItems}
          ready={ready}
          quote={shownQuote}
          totalSeats={totalSeats}
          onRemove={handleRemove}
          onCheckout={goToCheckout}
          onOpenDay={openDayFromCart}
        />
      </div>

      <MobileCartBar
        quote={shownQuote}
        totalSeats={totalSeats}
        cartItems={cartItems}
        onCheckout={goToCheckout}
        onRemove={handleRemove}
      />

      <BookingFooter className="flex lg:hidden" />
    </div>
  );
}

function BookingFooter({ className }: { className: string }) {
  return (
    <div
      className={`hull bg-hull font-plex-mono text-[13px] tracking-[.04em] ${className}`}
      style={{
        padding: "16px 24px",
        color: "#c9d2d8",
        borderTop: "2px solid #201e1d",
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
  );
}
