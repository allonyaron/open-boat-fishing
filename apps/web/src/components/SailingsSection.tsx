"use client";

import { useState } from "react";
import Link from "next/link";

export type FormattedSailing = {
  tripId: string;
  departureDate: string;
  productName: string;
  seatsRemaining: number;
  minCents: number | null;
  startTimeFormatted: string;
  departureDateFormatted: string;
};

function dollars(cents: number) {
  return `$${Math.round(cents / 100)}`;
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
  const [selectedDate, setSelectedDate] = useState<string | null>(null);

  const datesWithTrips = new Set(sailings.map((s) => s.departureDate));

  const filtered = selectedDate
    ? sailings.filter((s) => s.departureDate === selectedDate)
    : sailings;

  const sailingsByDate = new Map<string, FormattedSailing[]>();
  for (const trip of filtered) {
    if (!sailingsByDate.has(trip.departureDate)) sailingsByDate.set(trip.departureDate, []);
    sailingsByDate.get(trip.departureDate)!.push(trip);
  }
  const sailingDates = Array.from(sailingsByDate.keys());

  return (
    <div id="sailings">
      <div
        style={{
          padding: "48px 28px 0",
          borderTop: "2px solid #cdd6da",
          display: "flex",
          flexWrap: "wrap",
          gap: 12,
          alignItems: "baseline",
          justifyContent: "space-between",
        }}
      >
        <h2
          className="font-archivo font-bold uppercase"
          style={{ margin: 0, fontSize: "clamp(26px, 3.4vw, 34px)", letterSpacing: "-.02em" }}
        >
          Everything sailing this week
        </h2>
        <span className="font-plex-mono text-[13px] text-ink-3">{weekLabel}</span>
      </div>

      {/* Day chips */}
      <div
        style={{
          padding: "18px 28px 0",
          display: "flex",
          flexWrap: "wrap",
          gap: 6,
          alignItems: "stretch",
        }}
      >
        <button
          onClick={() => setSelectedDate(null)}
          className="font-plex-mono font-bold"
          style={{
            background: selectedDate === null ? "#c94510" : "#fff",
            color: selectedDate === null ? "#fff" : "#0d1c26",
            border: selectedDate === null ? "none" : "1px solid #cdd6da",
            minHeight: 52,
            display: "inline-flex",
            alignItems: "center",
            padding: "0 18px",
            fontSize: 13,
            letterSpacing: ".1em",
            cursor: "pointer",
            whiteSpace: "nowrap",
          }}
        >
          All week
        </button>

        {weekDates.map((dateStr) => {
          const dt = new Date(dateStr + "T12:00:00Z");
          const dow = dt
            .toLocaleDateString("en-US", { weekday: "short", timeZone: "UTC" })
            .toUpperCase();
          const day = dt.getUTCDate();
          const hasTrips = datesWithTrips.has(dateStr);
          const isSelected = selectedDate === dateStr;

          if (!hasTrips) {
            const dayName = dt.toLocaleDateString("en-US", {
              weekday: "long",
              month: "long",
              day: "numeric",
              timeZone: "UTC",
            });
            return (
              <span
                key={dateStr}
                aria-disabled="true"
                title={`No sailings ${dayName}`}
                style={{
                  border: "1px solid #dde4e6",
                  background: "#f1f4f5",
                  color: "#5b6f79",
                  minWidth: 52,
                  minHeight: 52,
                  display: "inline-flex",
                  flexDirection: "column",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 3,
                  cursor: "default",
                  padding: "0 10px",
                }}
              >
                <span
                  className="font-plex-mono font-bold"
                  style={{ fontSize: 10, letterSpacing: ".12em" }}
                >
                  {dow}
                </span>
                <span className="font-plex-mono font-bold" style={{ fontSize: 22, lineHeight: 1 }}>
                  {day}
                </span>
              </span>
            );
          }

          return (
            <button
              key={dateStr}
              onClick={() => setSelectedDate(isSelected ? null : dateStr)}
              style={{
                border: isSelected ? "none" : "1px solid #cdd6da",
                background: isSelected ? "#c94510" : "#fff",
                minWidth: 52,
                minHeight: 52,
                display: "inline-flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                gap: 3,
                cursor: "pointer",
                padding: "0 10px",
              }}
            >
              <span
                className="font-plex-mono font-bold"
                style={{
                  fontSize: 10,
                  letterSpacing: ".12em",
                  color: isSelected ? "rgba(255,255,255,.75)" : "#41565f",
                }}
              >
                {dow}
              </span>
              <span
                className="font-plex-mono font-bold"
                style={{ fontSize: 22, lineHeight: 1, color: isSelected ? "#fff" : "#0d1c26" }}
              >
                {day}
              </span>
            </button>
          );
        })}
      </div>

      {/* Sailings table */}
      <div style={{ padding: "20px 28px 0" }}>
        <div className="bg-white" style={{ border: "1px solid #cdd6da" }}>
          <div
            className="hidden sm:grid font-plex-mono text-[11px] tracking-[.12em] bg-hull"
            style={{
              gridTemplateColumns: "120px minmax(0,1fr) 120px 100px 130px 130px",
              gap: 16,
              padding: "11px 20px",
              color: "#8fa3ad",
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
              const fewLeft = !soldOut && trip.seatsRemaining <= 10;
              const seatLabel = soldOut
                ? "SOLD OUT"
                : fewLeft
                ? `${trip.seatsRemaining} LEFT`
                : `${trip.seatsRemaining} OPEN`;
              const seatColor = soldOut ? "#9aa8ae" : fewLeft ? "#8c3b12" : "#186a4a";

              return (
                <div
                  key={trip.tripId}
                  className="sm:grid"
                  style={{
                    gridTemplateColumns: "120px minmax(0,1fr) 120px 100px 130px 130px",
                    gap: 16,
                    padding: "16px 20px",
                    borderTop: "1px solid #e3e9eb",
                    alignItems: "center",
                    background: soldOut ? "#f1f4f5" : "transparent",
                  }}
                >
                  <span
                    className="font-plex-mono text-[14px]"
                    style={{ color: soldOut ? "#9aa8ae" : "#5b6f79" }}
                  >
                    {i === 0 ? trip.departureDateFormatted : ""}
                  </span>
                  <span
                    className="font-archivo text-[17px] font-semibold block mt-2 sm:mt-0"
                    style={{ color: soldOut ? "#9aa8ae" : undefined }}
                  >
                    {trip.productName}
                  </span>
                  <span
                    className="font-plex-mono text-[14px] block mt-1 sm:mt-0"
                    style={{ color: soldOut ? "#9aa8ae" : "#5b6f79" }}
                  >
                    {trip.startTimeFormatted}
                  </span>
                  <span
                    className="font-plex-mono text-[17px] font-semibold block mt-1 sm:mt-0"
                    style={{ color: soldOut ? "#9aa8ae" : undefined }}
                  >
                    {trip.minCents != null ? dollars(trip.minCents) : "—"}
                  </span>
                  <span
                    className="font-plex-mono text-[13px] font-semibold block mt-1 sm:mt-0"
                    style={{ color: seatColor }}
                  >
                    {seatLabel}
                  </span>
                  <div className="flex justify-start sm:justify-end mt-2 sm:mt-0">
                    {soldOut ? (
                      <Link
                        href="/book"
                        className="font-plex-mono text-[12px] font-bold tracking-[.1em]"
                        style={{
                          border: "1px solid #9aa8ae",
                          color: "#5b6f79",
                          minWidth: 116,
                          height: 40,
                          boxSizing: "border-box",
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
                          boxSizing: "border-box",
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
