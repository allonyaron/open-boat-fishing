import { fmtTimeET } from "@/lib/format";
import { DAYS_LONG, DAYS_SHORT, MONTHS, dollars, fmtFullDate, parseMonth } from "./format";
import type { Trip } from "./types";

export function MonthGrid({
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
