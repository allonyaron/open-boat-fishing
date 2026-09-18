"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import posthog from "posthog-js";
import { BookingNav } from "./BookingNav";
import { CartRail } from "./CartRail";
import { DayGroup } from "./DayGroup";
import { EmptyState } from "./EmptyState";
import { FilterBar } from "./FilterBar";
import { MobileCartBar } from "./MobileCartBar";
import { MonthGrid } from "./MonthGrid";
import { parseMonth, toMonthStr } from "./format";
import { useCart } from "./useCart";
import type { Trip, VesselInfo, ViewMode } from "./types";

export { BookingNav } from "./BookingNav";
export type { EnrichedCartItem, Trip } from "./types";

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

  // Refs for scroll targeting
  const tripCardRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const railScrollRef = useRef<HTMLDivElement>(null);
  const footerRef = useRef<HTMLDivElement>(null);
  const announceRef = useRef<HTMLDivElement>(null);
  const headerRef = useRef<HTMLDivElement>(null);

  const onInitialTripPreAdded = useCallback((departureDate: string) => {
    setSelectedDay(departureDate);
  }, []);

  const {
    cartItems,
    getQty,
    totalQtyForTrip,
    adjustQty,
    removeFromCart,
    totalCents,
    totalSeats,
  } = useCart({ trips, initialTripId, initialTrips, onInitialTripPreAdded });

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

  function handleRemove(tripId: string) {
    const removed = removeFromCart(tripId);
    if (announceRef.current) announceRef.current.textContent = `${removed?.productName ?? "Trip"} removed`;
  }

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
          onRemove={handleRemove}
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
