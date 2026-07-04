"use client";

import { useState } from "react";

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

// ─── Helpers ──────────────────────────────────────────────────────────────────

const MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];
const DAYS_SHORT = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];

function parseMonth(month: string) {
  const [y, m] = month.split("-").map(Number);
  return { year: y, mon: m };
}

function toMonthStr(year: number, mon: number) {
  return `${year}-${String(mon).padStart(2, "0")}`;
}

function fmtTime(iso: string) {
  return new Date(iso).toLocaleTimeString("en-US", {
    hour: "numeric", minute: "2-digit", timeZone: "America/New_York",
  });
}

function fmtDayLabel(dateStr: string) {
  const d = new Date(dateStr + "T12:00:00Z");
  return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
}

function weekDaysFor(dateStr: string): string[] {
  const d = new Date(dateStr + "T12:00:00Z");
  const dow = d.getUTCDay();
  const days: string[] = [];
  for (let i = 0; i < 7; i++) {
    const dd = new Date(d);
    dd.setUTCDate(d.getUTCDate() - dow + i);
    days.push(dd.toISOString().slice(0, 10));
  }
  return days;
}

function allDaysInMonth(month: string): string[] {
  const { year, mon } = parseMonth(month);
  const last = new Date(Date.UTC(year, mon, 0)).getUTCDate();
  return Array.from({ length: last }, (_, i) =>
    `${month}-${String(i + 1).padStart(2, "0")}`
  );
}

function dollars(cents: number) {
  return `$${Math.round(cents / 100)}`;
}

// ─── Stepper ──────────────────────────────────────────────────────────────────

function Stepper({ value, onChange }: { value: number; onChange: (n: number) => void }) {
  return (
    <div className="flex items-center gap-4">
      <button
        onClick={() => onChange(Math.max(0, value - 1))}
        disabled={value === 0}
        className={`w-[34px] h-[34px] rounded-pill flex items-center justify-center text-xl leading-none transition-colors ${
          value === 0
            ? "border border-[#E4E8E7] text-[#C3CBCA] cursor-default"
            : "border-[1.5px] border-teal text-teal"
        }`}
      >
        −
      </button>
      <span className="font-grotesk text-[17px] font-semibold min-w-[16px] text-center">{value}</span>
      <button
        onClick={() => onChange(value + 1)}
        className="w-[34px] h-[34px] rounded-pill bg-teal text-white flex items-center justify-center text-xl leading-none hover:bg-teal-hover transition-colors"
      >
        +
      </button>
    </div>
  );
}

// ─── Trip Card ────────────────────────────────────────────────────────────────

function TripCard({
  trip,
  selected,
  adult,
  child,
  onSelect,
  onAdult,
  onChild,
}: {
  trip: Trip;
  selected: boolean;
  adult: number;
  child: number;
  onSelect: () => void;
  onAdult: (n: number) => void;
  onChild: (n: number) => void;
}) {
  const adultPrice = trip.product.prices.find((p) => p.ticketType === "adult");
  const childPrice = trip.product.prices.find((p) => p.ticketType === "child");
  const lowStock = trip.seatsRemaining > 0 && trip.seatsRemaining <= 15;
  const soldOut = trip.seatsRemaining === 0;

  return (
    <div
      className={`bg-white rounded-card overflow-hidden transition-all duration-150 cursor-pointer ${
        selected
          ? "border-[1.5px] border-teal shadow-card-selected"
          : "border-[1.5px] border-card-border shadow-card"
      }`}
      onClick={onSelect}
    >
      {/* Card head */}
      <div className="p-4 flex gap-4 items-start">
        {/* Left */}
        <div className="flex-1 min-w-0 flex flex-col gap-[7px]">
          <span className="inline-block self-start text-[11px] font-bold tracking-[0.08em] uppercase text-teal bg-teal-tint px-2 py-0.5 rounded-badge">
            {trip.product.category}
          </span>
          <div className="font-grotesk text-[18px] font-semibold text-ink leading-tight">
            {trip.product.displayName}
          </div>
          <div className="flex items-center gap-1.5 text-[13px] text-muted">
            <ClockIcon />
            {fmtTime(trip.startTime)} – {fmtTime(trip.endTime)}
          </div>
          <div className="flex items-center gap-1.5 text-[13px] text-muted">
            <BoatIcon />
            {trip.vessel.name}
          </div>
        </div>

        {/* Right */}
        <div className="flex flex-col items-end gap-2 flex-shrink-0">
          {adultPrice && (
            <div className="font-grotesk text-[20px] font-bold text-ink">
              {dollars(adultPrice.priceCents)}
            </div>
          )}
          {trip.product.showRemaining && !soldOut && (
            <span
              className={`text-[12px] font-semibold px-[9px] py-1 rounded-pill ${
                lowStock
                  ? "bg-warning-bg text-warning"
                  : "bg-success-bg text-success"
              }`}
            >
              {lowStock ? `Only ${trip.seatsRemaining} left` : `${trip.seatsRemaining} available`}
            </span>
          )}
          {soldOut && (
            <span className="text-[12px] font-semibold px-[9px] py-1 rounded-pill bg-warning-bg text-warning">
              Sold out
            </span>
          )}
          {/* Radio indicator */}
          <div
            className={`w-[22px] h-[22px] rounded-pill border-2 flex items-center justify-center transition-colors ${
              selected ? "border-teal" : "border-[#D4DAD9]"
            }`}
          >
            {selected && <div className="w-[11px] h-[11px] rounded-pill bg-teal" />}
          </div>
        </div>
      </div>

      {/* Expanded ticket section */}
      {selected && !soldOut && (
        <div onClick={(e) => e.stopPropagation()}>
          <div className="h-px bg-hairline mx-4" />
          <div className="px-4 pt-3 pb-4 space-y-4">
            <div className="text-[11px] font-bold tracking-[0.1em] uppercase text-faint">
              Tickets
            </div>
            {adultPrice && (
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-[14px] font-semibold text-ink">Adult</div>
                  <div className="text-[13px] text-faint">{dollars(adultPrice.priceCents)} · 13+</div>
                </div>
                <Stepper value={adult} onChange={onAdult} />
              </div>
            )}
            {childPrice && (
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-[14px] font-semibold text-ink">Child</div>
                  <div className="text-[13px] text-faint">{dollars(childPrice.priceCents)} · 5–12</div>
                </div>
                <Stepper value={child} onChange={onChild} />
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Month Grid ───────────────────────────────────────────────────────────────

function MonthGrid({
  month,
  availableDays,
  onDaySelect,
}: {
  month: string;
  availableDays: Set<string>;
  onDaySelect: (day: string) => void;
}) {
  const { year, mon } = parseMonth(month);
  const firstDow = new Date(Date.UTC(year, mon - 1, 1)).getUTCDay();
  const days = allDaysInMonth(month);
  const cells: (string | null)[] = [...Array(firstDow).fill(null), ...days];
  while (cells.length % 7 !== 0) cells.push(null);
  const today = new Date().toISOString().slice(0, 10);

  return (
    <div>
      <div className="grid grid-cols-7 mb-1">
        {DAYS_SHORT.map((d) => (
          <div key={d} className="text-center text-[10px] font-bold text-faint uppercase py-2">
            {d}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-1">
        {cells.map((date, i) => {
          if (!date) return <div key={i} />;
          const avail = availableDays.has(date);
          const isToday = date === today;
          const dayNum = parseInt(date.slice(-2));
          const tripCount = avail ? 1 : 0; // simplified — real count comes from grouping

          return (
            <button
              key={date}
              disabled={!avail}
              onClick={() => onDaySelect(date)}
              className={`min-h-[78px] rounded-[12px] p-2 text-left transition-all ${
                avail
                  ? "border border-card-border bg-white hover:border-teal/40 hover:shadow-sm"
                  : "bg-[#FAFBFB] border border-[#F0F2F2] cursor-default"
              } ${isToday ? "ring-1 ring-teal/30" : ""}`}
            >
              <div
                className={`font-grotesk text-[14px] font-semibold ${
                  avail ? "text-ink" : "text-[#C3CBCA]"
                }`}
              >
                {dayNum}
              </div>
              {avail && (
                <div className="mt-1.5 inline-block text-[10px] font-bold text-teal bg-teal-tint px-1.5 py-0.5 rounded-[5px]">
                  {tripCount > 1 ? `${tripCount} trips` : "trips"}
                </div>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ─── Week Strip ───────────────────────────────────────────────────────────────

function WeekStrip({
  selDay,
  availableDays,
  onDaySelect,
  onBack,
}: {
  selDay: string;
  availableDays: Set<string>;
  onDaySelect: (day: string) => void;
  onBack: () => void;
}) {
  const weekDays = weekDaysFor(selDay);

  return (
    <div>
      <button
        onClick={onBack}
        className="mb-3 text-[15px] font-semibold text-teal font-grotesk flex items-center gap-1 border border-[#CFE4E3] bg-[#F1FAF9] px-3 py-1.5 rounded-pill"
      >
        ‹ Back to month
      </button>
      <div className="flex gap-2.5 overflow-x-auto pb-1">
        {weekDays.map((date) => {
          const avail = availableDays.has(date);
          const isSelected = date === selDay;
          const d = new Date(date + "T12:00:00Z");
          const dow = DAYS_SHORT[d.getUTCDay()];
          const dayNum = d.getUTCDate();

          return (
            <button
              key={date}
              disabled={!avail}
              onClick={() => avail && onDaySelect(date)}
              className={`flex-shrink-0 w-[58px] rounded-[18px] py-3 pb-2.5 flex flex-col items-center gap-1.5 transition-all ${
                isSelected
                  ? "bg-teal shadow-day-selected"
                  : avail
                  ? "bg-fill hover:bg-teal/10"
                  : "opacity-45 bg-fill cursor-default"
              }`}
            >
              <span
                className={`text-[11px] font-semibold tracking-[0.06em] uppercase ${
                  isSelected ? "text-white/85" : "text-faint"
                }`}
              >
                {dow}
              </span>
              <span
                className={`font-grotesk text-[19px] font-semibold ${
                  isSelected ? "text-white" : "text-ink"
                }`}
              >
                {dayNum}
              </span>
              <div
                className={`w-[5px] h-[5px] rounded-pill ${
                  isSelected ? "bg-white" : avail ? "bg-teal" : "bg-transparent"
                }`}
              />
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ─── Main Calendar ────────────────────────────────────────────────────────────

export function BookingCalendar({
  initialTrips,
  initialMonth,
}: {
  initialTrips: Trip[];
  initialMonth: string;
}) {
  const [month, setMonth] = useState(initialMonth);
  const [trips, setTrips] = useState(initialTrips);
  const [loading, setLoading] = useState(false);
  const [calView, setCalView] = useState<"month" | "week">("month");
  const [selDay, setSelDay] = useState<string | null>(null);
  const [selectedTripId, setSelectedTripId] = useState<string | null>(null);
  const [adult, setAdult] = useState(0);
  const [child, setChild] = useState(0);

  const { year, mon } = parseMonth(month);

  async function goToMonth(newMonth: string) {
    setLoading(true);
    const res = await fetch(`/api/trips?month=${newMonth}`);
    const data = await res.json();
    setTrips(data);
    setMonth(newMonth);
    setCalView("month");
    setSelDay(null);
    setSelectedTripId(null);
    setAdult(0);
    setChild(0);
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

  function handleDaySelect(day: string) {
    setSelDay(day);
    setCalView("week");
    const dayTrips = byDate[day] ?? [];
    setSelectedTripId(dayTrips[0]?.id ?? null);
    setAdult(0);
    setChild(0);
  }

  function handleTripSelect(tripId: string) {
    if (tripId === selectedTripId) return;
    setSelectedTripId(tripId);
    setAdult(0);
    setChild(0);
  }

  const byDate = trips.reduce<Record<string, Trip[]>>((acc, t) => {
    (acc[t.departureDate] ??= []).push(t);
    return acc;
  }, {});

  const availableDays = new Set(Object.keys(byDate));
  const dayTrips = selDay ? (byDate[selDay] ?? []) : [];
  const selectedTrip = dayTrips.find((t) => t.id === selectedTripId) ?? null;

  const adultPrice = selectedTrip?.product.prices.find((p) => p.ticketType === "adult");
  const childPrice = selectedTrip?.product.prices.find((p) => p.ticketType === "child");
  const total = (adult * (adultPrice?.priceCents ?? 0)) + (child * (childPrice?.priceCents ?? 0));
  const ticketCount = adult + child;
  const canReserve = ticketCount > 0;

  return (
    <div className="min-h-screen bg-surface font-jakarta">
      {/* App bar */}
      <header className="bg-white border-b border-hairline h-[66px] flex items-center justify-between px-5 md:px-8">
        <div className="flex items-center gap-3">
          <div className="w-[34px] h-[34px] rounded-[10px] bg-teal flex items-center justify-center flex-shrink-0">
            <BoatIconWhite />
          </div>
          <span className="font-grotesk text-[17px] font-semibold text-ink">OpenBoat Fishing</span>
        </div>
        <div className="flex items-center gap-3">
          <div className="hidden sm:flex items-center gap-1.5 text-[12px] font-medium text-muted bg-fill px-3 py-1.5 rounded-pill">
            <PinIcon />
            Captree State Park, NY
          </div>
          <div className="w-[34px] h-[34px] rounded-pill bg-teal-tint flex items-center justify-center text-[13px] font-semibold text-teal">
            JD
          </div>
        </div>
      </header>

      <div className="max-w-[1120px] mx-auto px-5 md:px-8">
        <div className="md:grid md:gap-7 py-6" style={{ gridTemplateColumns: "1fr 372px" }}>

          {/* ── Left column ─────────────────────────────────────── */}
          <div>
            {/* Title + month nav */}
            <div className="flex items-center justify-between mb-5">
              <h1 className="font-grotesk text-[26px] font-semibold text-ink">Book a trip</h1>
              <div className="flex items-center gap-2">
                <button
                  onClick={prevMonth}
                  className="w-[34px] h-[34px] rounded-[10px] border border-card-border bg-white flex items-center justify-center text-muted hover:bg-fill transition-colors"
                >
                  ‹
                </button>
                <span className="font-grotesk text-[15px] font-semibold text-ink min-w-[92px] text-center">
                  {MONTHS[mon - 1]} {year}
                </span>
                <button
                  onClick={nextMonth}
                  className="w-[34px] h-[34px] rounded-[10px] border border-card-border bg-white flex items-center justify-center text-muted hover:bg-fill transition-colors"
                >
                  ›
                </button>
              </div>
            </div>

            {/* Calendar */}
            <div className={`transition-opacity ${loading ? "opacity-40 pointer-events-none" : ""}`}>
              {calView === "month" ? (
                <MonthGrid
                  month={month}
                  availableDays={availableDays}
                  onDaySelect={handleDaySelect}
                />
              ) : selDay ? (
                <WeekStrip
                  selDay={selDay}
                  availableDays={availableDays}
                  onDaySelect={handleDaySelect}
                  onBack={() => { setCalView("month"); setSelDay(null); }}
                />
              ) : null}
            </div>

            {/* Trip list or empty state */}
            <div className="mt-5">
              {calView === "month" && (
                <div className="flex flex-col items-center justify-center py-12 text-center">
                  <div className="w-[46px] h-[46px] rounded-[14px] bg-teal-tint flex items-center justify-center mb-3">
                    <CalendarIcon />
                  </div>
                  <div className="font-grotesk text-[16px] font-semibold text-ink mb-1">
                    Pick a date to start
                  </div>
                  <div className="text-[13px] text-faint max-w-[220px]">
                    Tap any highlighted day to see the trips sailing that day.
                  </div>
                </div>
              )}

              {calView === "week" && selDay && (
                <>
                  <div className="mb-3 flex items-baseline gap-2">
                    <span className="font-grotesk text-[17px] font-semibold text-ink">
                      {fmtDayLabel(selDay)}
                    </span>
                    <span className="text-[13px] text-faint">
                      · {dayTrips.length} trip{dayTrips.length !== 1 ? "s" : ""} available
                    </span>
                  </div>
                  <div className="space-y-3 pb-36">
                    {dayTrips.map((trip) => (
                      <TripCard
                        key={trip.id}
                        trip={trip}
                        selected={trip.id === selectedTripId}
                        adult={trip.id === selectedTripId ? adult : 0}
                        child={trip.id === selectedTripId ? child : 0}
                        onSelect={() => handleTripSelect(trip.id)}
                        onAdult={setAdult}
                        onChild={setChild}
                      />
                    ))}
                  </div>
                </>
              )}
            </div>
          </div>

          {/* ── Right column — sticky summary (desktop only) ─────── */}
          {selectedTrip && (
            <div className="hidden md:block">
              <div className="sticky top-6 bg-white border border-card-border rounded-[22px] shadow-summary p-[22px] space-y-4">
                <div>
                  <span className="inline-block text-[11px] font-bold tracking-[0.08em] uppercase text-teal bg-teal-tint px-2 py-0.5 rounded-badge mb-1">
                    {selectedTrip.product.category}
                  </span>
                  <div className="font-grotesk text-[21px] font-semibold text-ink leading-tight">
                    {selectedTrip.product.displayName}
                  </div>
                  {selDay && (
                    <div className="text-[13px] text-faint mt-0.5">{fmtDayLabel(selDay)}</div>
                  )}
                </div>

                {/* Details tile */}
                <div className="grid grid-cols-3 bg-[#F7F9F9] rounded-[14px] p-3.5 gap-3">
                  {[
                    { label: "DEPARTS", value: fmtTime(selectedTrip.startTime) },
                    { label: "RETURNS", value: fmtTime(selectedTrip.endTime) },
                    { label: "BOAT", value: selectedTrip.vessel.name },
                  ].map((d) => (
                    <div key={d.label}>
                      <div className="text-[10px] font-bold text-faint uppercase tracking-wide">{d.label}</div>
                      <div className="text-[14px] font-semibold text-ink mt-0.5">{d.value}</div>
                    </div>
                  ))}
                </div>

                {/* Availability */}
                {selectedTrip.product.showRemaining && (
                  <div className="flex items-center gap-2 text-[13px] font-semibold text-success">
                    <div className="w-2 h-2 rounded-pill bg-success" />
                    {selectedTrip.seatsRemaining} tickets available
                  </div>
                )}

                <div className="h-px bg-hairline" />

                {/* Ticket steppers */}
                <div>
                  <div className="text-[11px] font-bold tracking-[0.1em] uppercase text-faint mb-3">Tickets</div>
                  <div className="space-y-4">
                    {adultPrice && (
                      <div className="flex items-center justify-between">
                        <div>
                          <div className="text-[14px] font-semibold text-ink">Adult</div>
                          <div className="text-[13px] text-faint">{dollars(adultPrice.priceCents)} · 13+</div>
                        </div>
                        <Stepper value={adult} onChange={setAdult} />
                      </div>
                    )}
                    {childPrice && (
                      <div className="flex items-center justify-between">
                        <div>
                          <div className="text-[14px] font-semibold text-ink">Child</div>
                          <div className="text-[13px] text-faint">{dollars(childPrice.priceCents)} · 5–12</div>
                        </div>
                        <Stepper value={child} onChange={setChild} />
                      </div>
                    )}
                  </div>
                </div>

                <div className="h-px bg-hairline" />

                {/* Order summary */}
                {ticketCount === 0 ? (
                  <div className="text-center text-[#A8B4B3] text-[13px] py-2">No tickets added yet</div>
                ) : (
                  <div className="space-y-2">
                    {adult > 0 && adultPrice && (
                      <div className="flex justify-between text-[14px]">
                        <span className="text-muted">Adult × {adult}</span>
                        <span className="font-semibold text-ink">{dollars(adult * adultPrice.priceCents)}</span>
                      </div>
                    )}
                    {child > 0 && childPrice && (
                      <div className="flex justify-between text-[14px]">
                        <span className="text-muted">Child × {child}</span>
                        <span className="font-semibold text-ink">{dollars(child * childPrice.priceCents)}</span>
                      </div>
                    )}
                    <div className="flex justify-between items-baseline pt-1 border-t border-hairline">
                      <span className="text-[15px] font-semibold text-ink">Total</span>
                      <span className="font-grotesk text-[24px] font-bold text-ink">{dollars(total)}</span>
                    </div>
                  </div>
                )}

                <button
                  disabled={!canReserve}
                  className={`w-full py-[15px] rounded-btn font-grotesk text-[15px] font-semibold flex items-center justify-center gap-2 transition-colors ${
                    canReserve
                      ? "bg-teal text-white hover:bg-teal-hover"
                      : "bg-disabled text-disabled-text cursor-default"
                  }`}
                >
                  {canReserve ? "Reserve" : "Select tickets"}
                  <ArrowIcon />
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Mobile checkout bar */}
      {calView === "week" && (
        <div className="md:hidden fixed bottom-0 left-0 right-0 bg-white/92 backdrop-blur-[14px] border-t border-hairline px-5 pt-3.5 pb-8 flex items-center justify-between">
          <div>
            <div className="font-grotesk text-[22px] font-bold text-ink">
              {ticketCount > 0 ? dollars(total) : "—"}
            </div>
            <div className="text-[12px] text-faint mt-0.5">
              {ticketCount > 0
                ? `${ticketCount} ticket${ticketCount !== 1 ? "s" : ""} · ${selectedTrip?.product.displayName ?? ""}`
                : "No tickets added yet"}
            </div>
          </div>
          <button
            disabled={!canReserve}
            className={`flex items-center gap-2 px-[22px] py-[14px] rounded-btn font-grotesk text-[15px] font-semibold transition-colors ${
              canReserve
                ? "bg-teal text-white hover:bg-teal-hover"
                : "bg-disabled text-disabled-text cursor-default"
            }`}
          >
            {canReserve ? "Reserve" : "Select tickets"}
            <ArrowIcon />
          </button>
        </div>
      )}
    </div>
  );
}

// ─── Inline SVG icons ─────────────────────────────────────────────────────────

function ClockIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
    </svg>
  );
}

function BoatIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2 20a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2"/><path d="M4 20l2-8h12l2 8"/><path d="M12 4v8"/><path d="M8 8h8"/>
    </svg>
  );
}

function BoatIconWhite() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2 20a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2"/><path d="M4 20l2-8h12l2 8"/><path d="M12 4v8"/><path d="M8 8h8"/>
    </svg>
  );
}

function PinIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/>
    </svg>
  );
}

function CalendarIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#0E7C7B" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect width="18" height="18" x="3" y="4" rx="2" ry="2"/><line x1="16" x2="16" y1="2" y2="6"/><line x1="8" x2="8" y1="2" y2="6"/><line x1="3" x2="21" y1="10" y2="10"/>
    </svg>
  );
}

function ArrowIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M5 12h14"/><path d="m12 5 7 7-7 7"/>
    </svg>
  );
}
