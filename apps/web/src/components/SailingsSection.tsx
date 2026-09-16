"use client";

import { useState } from "react";
import Link from "next/link";
import { BoatGlyph } from "@/components/icons/BoatGlyph";

export type FormattedSailing = {
  tripId: string;
  departureDate: string;
  productName: string;
  category: string;
  tripTypeColor: string;
  tripTypeLabel: string;
  durationLabel: string;
  seatsRemaining: number;
  minCents: number | null;
  startTimeFormatted: string;
  departureDateFormatted: string;
};

function dollars(cents: number) {
  return `$${Math.round(cents / 100)}`;
}

function SeatPill({ seatsRemaining }: { seatsRemaining: number }) {
  const soldOut = seatsRemaining === 0;
  const fewLeft = !soldOut && seatsRemaining <= 6;
  const label = soldOut ? "SOLD OUT" : fewLeft ? `${seatsRemaining} LEFT` : `${seatsRemaining} OPEN`;
  const color = soldOut ? "#5b6f79" : fewLeft ? "#8c3b12" : "#186a4a";
  return (
    <span
      className="font-plex-mono font-semibold"
      style={{ fontSize: 11, letterSpacing: ".06em", color }}
    >
      {label}
    </span>
  );
}

function fmtDayHeadDate(dateStr: string, todayStr: string): string {
  const dt = new Date(dateStr + "T12:00:00Z");
  const dow = dt.toLocaleDateString("en-US", { weekday: "long", timeZone: "UTC" }).toUpperCase();
  const mon = dt.toLocaleDateString("en-US", { month: "long", timeZone: "UTC" }).toUpperCase();
  const day = dt.getUTCDate();
  const suffix = dateStr === todayStr ? " · TODAY" : "";
  return `${dow} ${mon} ${day}${suffix}`;
}

export function SailingsSection({
  sailings,
  weekLabel,
  weekDates,
}: {
  sailings: FormattedSailing[];
  weekLabel: string;
  weekDates: string[];
}) {
  const todayStr = weekDates[0] ?? "";
  const [selectedDate, setSelectedDate] = useState<string | null>(todayStr || null);
  const [showAllWeek, setShowAllWeek] = useState(false);

  const datesWithTrips = new Set(sailings.map((s) => s.departureDate));
  const tripCountByDate = new Map<string, number>();
  for (const s of sailings) {
    tripCountByDate.set(s.departureDate, (tripCountByDate.get(s.departureDate) ?? 0) + 1);
  }

  // If showAllWeek, show all; otherwise show selected date (or today if none)
  const effectiveDate = showAllWeek ? null : selectedDate;
  const filtered = effectiveDate
    ? sailings.filter((s) => s.departureDate === effectiveDate)
    : sailings;

  const sailingsByDate = new Map<string, FormattedSailing[]>();
  for (const trip of filtered) {
    if (!sailingsByDate.has(trip.departureDate)) sailingsByDate.set(trip.departureDate, []);
    sailingsByDate.get(trip.departureDate)!.push(trip);
  }
  const sailingDates = Array.from(sailingsByDate.keys());

  return (
    <div id="sailings">
      {/* ── Section head ─────────────────────────────────── */}
      <div
        style={{ padding: "22px 16px 0" }}
        className="lg:px-[28px] lg:pt-[48px] lg:border-t-2 lg:border-rule"
      >
        <div className="flex items-baseline justify-between gap-3 flex-wrap">
          <h2
            className="font-archivo font-bold uppercase"
            style={{ margin: 0, fontSize: "clamp(21px, 3.4vw, 34px)", letterSpacing: "-.01em", color: "#16354a" }}
          >
            SAILING THIS WEEK
          </h2>
          <div className="flex items-center gap-3">
            <span className="font-plex-mono text-[11px] text-ink-3 hidden lg:inline">{weekLabel}</span>
            <button
              type="button"
              onClick={() => setShowAllWeek((v) => !v)}
              className="font-plex-mono font-semibold"
              style={{
                fontSize: 11,
                letterSpacing: ".1em",
                background: "none",
                border: "none",
                cursor: "pointer",
                color: showAllWeek ? "#c94510" : "#41565f",
                padding: 0,
              }}
            >
              {showAllWeek ? "SHOWING ALL WEEK" : "SHOW ALL WEEK"}
            </button>
          </div>
        </div>
      </div>

      {/* ── Week belt — 7-column grid at all widths ── */}
      <div
        className="sticky bg-deck border-b border-rule"
        style={{ top: 54, zIndex: 10, padding: "10px 16px 10px", marginTop: 10 }}
      >
        <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 2 }}>
          {weekDates.map((dateStr) => {
            const dt = new Date(dateStr + "T12:00:00Z");
            const dow = dt.toLocaleDateString("en-US", { weekday: "short", timeZone: "UTC" }).slice(0, 2).toUpperCase();
            const day = dt.getUTCDate();
            const hasTrips = datesWithTrips.has(dateStr);
            const count = tripCountByDate.get(dateStr) ?? 0;
            const isSelected = !showAllWeek && selectedDate === dateStr;

            return (
              <button
                key={dateStr}
                type="button"
                onClick={() => {
                  if (!hasTrips) return;
                  setShowAllWeek(false);
                  setSelectedDate(dateStr);
                }}
                style={{
                  minHeight: 56,
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 1,
                  border: "none",
                  cursor: hasTrips ? "pointer" : "default",
                  background: isSelected ? "#c94510" : hasTrips ? "#fff" : "#f1f4f5",
                  boxShadow: "inset 0 0 0 1px #cdd6da",
                  padding: "4px 2px",
                }}
              >
                <span
                  className="font-plex-mono"
                  style={{ fontSize: 9, fontWeight: 500, letterSpacing: ".06em", color: isSelected ? "#ffe3d6" : "#5b6f79" }}
                >
                  {dow}
                </span>
                <span
                  className="font-archivo font-bold"
                  style={{ fontSize: 19, lineHeight: 1, color: isSelected ? "#fff" : hasTrips ? "#16354a" : "#5b6f79" }}
                >
                  {day}
                </span>
                {/* Mobile: count + glyph */}
                <span
                  className="flex lg:hidden"
                  style={{ alignItems: "center", justifyContent: "center", gap: 3, height: 11 }}
                >
                  {hasTrips ? (
                    <>
                      <span className="font-plex-mono font-semibold" style={{ fontSize: 10, color: isSelected ? "#ffe3d6" : "#5b6f79" }}>
                        {count}
                      </span>
                      <BoatGlyph color={isSelected ? "#ffe3d6" : "#5b6f79"} />
                    </>
                  ) : null}
                </span>
                {/* Desktop: count + glyph + word on one line */}
                <span
                  className="hidden lg:flex"
                  style={{ alignItems: "center", justifyContent: "center", gap: 3, height: 11 }}
                >
                  {hasTrips ? (
                    <>
                      <span className="font-plex-mono font-semibold" style={{ fontSize: 9, letterSpacing: ".06em", color: isSelected ? "#ffe3d6" : "#5b6f79" }}>
                        {count === 1 ? "1 TRIP" : `${count} TRIPS`}
                      </span>
                    </>
                  ) : null}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* ── Trip list ────────────────────────────────────── */}
      <div style={{ padding: "0 16px" }} className="lg:px-[28px]">

        {/* Mobile: card layout */}
        <div className="lg:hidden">
          {sailingDates.length === 0 && (
            <div className="font-archivo text-[15px] text-ink-3" style={{ padding: "24px 0" }}>
              No sailings on that day.
            </div>
          )}
          {sailingDates.map((date) => {
            const dayTrips = sailingsByDate.get(date)!;
            const dayHeadLabel = fmtDayHeadDate(date, todayStr);
            const dayCount = dayTrips.length;
            return (
              <div key={date}>
                {/* Day head row */}
                <div
                  className="flex items-center justify-between"
                  style={{ paddingTop: 20, paddingBottom: 8 }}
                >
                  <span
                    className="font-plex-mono font-semibold"
                    style={{ fontSize: 11, letterSpacing: ".14em", color: "#41565f" }}
                  >
                    {dayHeadLabel}
                  </span>
                  <span
                    className="font-plex-mono"
                    style={{ fontSize: 11, letterSpacing: ".1em", color: "#5b6f79" }}
                  >
                    {dayCount} {dayCount === 1 ? "SAILING" : "SAILINGS"}
                  </span>
                </div>

                {/* Trip cards */}
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  {dayTrips.map((trip) => {
                    const soldOut = trip.seatsRemaining === 0;
                    return (
                      <Link
                        key={trip.tripId}
                        href={soldOut ? "#" : `/book?date=${trip.departureDate}&trip=${trip.tripId}`}
                        style={{
                          display: "flex",
                          textDecoration: "none",
                          background: soldOut ? "#f1f4f5" : "#fff",
                          boxShadow: "inset 0 0 0 1px #cdd6da",
                          position: "relative",
                          overflow: "hidden",
                        }}
                        aria-disabled={soldOut}
                      >
                        {/* Type color bar */}
                        <div
                          style={{
                            width: 6,
                            flexShrink: 0,
                            background: soldOut ? "#9aa8ae" : trip.tripTypeColor,
                          }}
                        />
                        {/* Content */}
                        <div style={{ padding: "14px 14px 14px 12px", flex: 1, minWidth: 0 }}>
                          {/* Time + price */}
                          <div className="flex items-baseline justify-between">
                            <span
                              className="font-plex-mono font-semibold"
                              style={{ fontSize: 15, color: soldOut ? "#9aa8ae" : "#16354a" }}
                            >
                              {trip.startTimeFormatted}
                            </span>
                            <span
                              className="font-archivo font-bold"
                              style={{ fontSize: 20, color: soldOut ? "#9aa8ae" : "#16354a" }}
                            >
                              {trip.minCents != null ? dollars(trip.minCents) : "—"}
                            </span>
                          </div>
                          {/* Trip name */}
                          <div
                            className="font-archivo font-semibold"
                            style={{
                              fontSize: 16,
                              lineHeight: 1.2,
                              marginTop: 6,
                              color: soldOut ? "#9aa8ae" : "#16354a",
                            }}
                          >
                            {trip.productName}
                          </div>
                          {/* Meta row */}
                          <div
                            className="flex flex-wrap items-center"
                            style={{ marginTop: 8, gap: 12 }}
                          >
                            {showAllWeek && (
                              <span
                                className="font-plex-mono font-semibold"
                                style={{ fontSize: 11, letterSpacing: ".14em", color: "#c94510" }}
                              >
                                {trip.departureDateFormatted}
                              </span>
                            )}
                            <span
                              className="font-plex-mono"
                              style={{ fontSize: 11, color: "#5b6f79" }}
                            >
                              {trip.tripTypeLabel} · {trip.durationLabel}
                            </span>
                            <SeatPill seatsRemaining={trip.seatsRemaining} />
                          </div>
                        </div>
                      </Link>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>

        {/* Desktop: table layout (unchanged) */}
        <div className="hidden lg:block bg-white mt-[20px]" style={{ border: "1px solid #cdd6da" }}>
          <div
            className="font-plex-mono text-[11px] tracking-[.12em] bg-hull"
            style={{
              display: "grid",
              gridTemplateColumns: "120px minmax(0,1fr) 120px 100px 130px 130px",
              gap: 16,
              padding: "11px 20px",
              color: "#c9d6dd",
              alignItems: "center",
            }}
          >
            <span>DATE</span>
            <span>TRIP</span>
            <span>DEPARTS</span>
            <span>FARE</span>
            <span>SEATS</span>
            <span />
          </div>

          {sailingDates.length === 0 && (
            <div className="font-archivo text-[15px] text-ink-3" style={{ padding: "24px 20px" }}>
              No sailings on that day.
            </div>
          )}

          {sailingDates.map((date) => {
            const dayTrips = sailingsByDate.get(date)!;
            return dayTrips.map((trip, i) => {
              const soldOut = trip.seatsRemaining === 0;
              return (
                <div
                  key={trip.tripId}
                  style={{
                    display: "grid",
                    gridTemplateColumns: "120px minmax(0,1fr) 120px 100px 130px 130px",
                    gap: 16,
                    padding: "16px 20px",
                    borderTop: "1px solid #e3e9eb",
                    alignItems: "center",
                    background: soldOut ? "#f1f4f5" : "transparent",
                  }}
                >
                  <span className="font-plex-mono text-[14px]" style={{ color: soldOut ? "#9aa8ae" : "#5b6f79" }}>
                    {i === 0 ? trip.departureDateFormatted : ""}
                  </span>
                  <span className="font-archivo text-[17px] font-semibold" style={{ color: soldOut ? "#9aa8ae" : undefined }}>
                    {trip.productName}
                  </span>
                  <span className="font-plex-mono text-[14px]" style={{ color: soldOut ? "#9aa8ae" : "#5b6f79" }}>
                    {trip.startTimeFormatted}
                  </span>
                  <span className="font-plex-mono text-[17px] font-semibold" style={{ color: soldOut ? "#9aa8ae" : undefined }}>
                    {trip.minCents != null ? dollars(trip.minCents) : "—"}
                  </span>
                  <SeatPill seatsRemaining={trip.seatsRemaining} />
                  <div className="flex justify-end">
                    {soldOut ? (
                      <Link
                        href="/book"
                        className="font-plex-mono text-[12px] font-bold tracking-[.1em]"
                        style={{
                          boxShadow: "inset 0 0 0 1px #9aa8ae",
                          color: "#5b6f79",
                          minWidth: 116,
                          height: 40,
                          display: "inline-flex",
                          alignItems: "center",
                          justifyContent: "center",
                          textDecoration: "none",
                        }}
                      >
                        WAITLIST
                      </Link>
                    ) : (
                      <Link
                        href={`/book?trip=${trip.tripId}`}
                        className="bg-orange hover:bg-orange-press transition-colors text-white font-plex-mono text-[12px] font-bold tracking-[.1em]"
                        style={{
                          minWidth: 116,
                          height: 40,
                          display: "inline-flex",
                          alignItems: "center",
                          justifyContent: "center",
                          textDecoration: "none",
                        }}
                      >
                        BOOK
                      </Link>
                    )}
                  </div>
                </div>
              );
            });
          })}
        </div>
      </div>
    </div>
  );
}
