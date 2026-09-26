import { DAYS_SINGLE, MONTHS, parseMonth } from "./format";
import type { Trip } from "./types";

export function RailCalendar({
  month,
  byDate,
  selectedDay,
  cartDates,
  headerH,
  onDaySelect,
  onPrevMonth,
  onNextMonth,
}: {
  month: string;
  byDate: Record<string, Trip[]>;
  selectedDay: string | null;
  cartDates: Set<string>;
  headerH: number;
  onDaySelect: (date: string) => void;
  onPrevMonth: () => void;
  onNextMonth: () => void;
}) {
  const { year, mon } = parseMonth(month);
  const monthLabel = `${MONTHS[mon - 1].toUpperCase()} ${year}`;
  const firstDow = new Date(Date.UTC(year, mon - 1, 1)).getUTCDay();
  const lastDay = new Date(Date.UTC(year, mon, 0)).getUTCDate();
  const days = Array.from({ length: lastDay }, (_, i) =>
    `${month}-${String(i + 1).padStart(2, "0")}`
  );
  const cells: (string | null)[] = [...Array(firstDow).fill(null), ...days];
  while (cells.length % 7 !== 0) cells.push(null);

  return (
    <div
      className="bg-deck-2"
      style={{
        position: "sticky",
        top: headerH,
        zIndex: 3,
        borderBottom: "1px solid #cdd6da",
        padding: "16px 22px",
      }}
    >
      {/* Month navigation */}
      <div className="flex items-center justify-between mb-3">
        <button
          type="button"
          onClick={onPrevMonth}
          aria-label="Previous month"
          className="flex items-center justify-center bg-transparent text-hull cursor-pointer hover:text-hull-2 transition-colors border-none"
          style={{
            width: 44,
            height: 44,
            border: "1px solid #3c5867",
            fontSize: 20,
            lineHeight: 1,
          }}
        >
          ‹
        </button>
        <span className="font-plex-mono text-[13px] font-semibold tracking-[.1em] text-hull">
          {monthLabel}
        </span>
        <button
          type="button"
          onClick={onNextMonth}
          aria-label="Next month"
          className="flex items-center justify-center bg-transparent text-hull cursor-pointer hover:text-hull-2 transition-colors border-none"
          style={{
            width: 44,
            height: 44,
            border: "1px solid #3c5867",
            fontSize: 20,
            lineHeight: 1,
          }}
        >
          ›
        </button>
      </div>

      {/* Full grid — hidden at max-height: 720px */}
      <div className="booking-rail-cal-grid">
        {/* Weekday headers */}
        <div className="grid grid-cols-7 mb-1">
          {DAYS_SINGLE.map((d, i) => (
            <div
              key={i}
              className="font-plex-mono text-[10px] text-center"
              style={{ color: "#a7b3b8" }}
            >
              {d}
            </div>
          ))}
        </div>

        {/* Day cells */}
        <div className="grid grid-cols-7" style={{ gap: 4 }}>
          {cells.map((date, i) => {
            if (!date) return <div key={`empty-${i}`} style={{ height: 38 }} />;

            const hasSailings = (byDate[date]?.length ?? 0) > 0;
            const inCart = cartDates.has(date);
            const isSelected = date === selectedDay;
            const dayNum = parseInt(date.slice(-2));

            let bg = "transparent";
            let textColor = "#a7b3b8";
            let dotColor: string | null = null;
            let border = "none";

            if (hasSailings) {
              bg = isSelected ? "#c94510" : "#ffffff";
              textColor = isSelected ? "#ffffff" : "#16354a";
              dotColor = inCart ? "#c94510" : "#16354a";
              if (isSelected) dotColor = "#ffffff";
              border = isSelected ? "none" : "1px solid #cdd6da";
            }

            return (
              <button
                key={date}
                type="button"
                onClick={() => hasSailings && onDaySelect(date)}
                disabled={!hasSailings}
                aria-pressed={isSelected}
                aria-label={`${date}${hasSailings ? ", has sailings" : ", no sailings"}`}
                className="flex flex-col items-center justify-center transition-colors border-none"
                style={{
                  height: 38,
                  background: bg,
                  border,
                  cursor: hasSailings ? "pointer" : "default",
                  gap: 3,
                  fontFamily: "inherit",
                  padding: 0,
                }}
              >
                <span
                  className="font-plex-mono text-[12px]"
                  style={{ color: textColor, lineHeight: 1 }}
                >
                  {dayNum}
                </span>
                {dotColor && (
                  <span
                    style={{
                      display: "block",
                      width: 5,
                      height: 5,
                      borderRadius: "50%",
                      background: dotColor,
                      flexShrink: 0,
                    }}
                  />
                )}
              </button>
            );
          })}
        </div>

        {/* Legend */}
        <div className="flex items-center gap-4 mt-3">
          <span
            className="flex items-center gap-[6px] font-plex-mono text-[11px]"
            style={{ color: "#41565f" }}
          >
            <span
              style={{
                display: "inline-block",
                width: 6,
                height: 6,
                borderRadius: "50%",
                background: "#16354a",
              }}
            />
            SAILING
          </span>
          <span
            className="flex items-center gap-[6px] font-plex-mono text-[11px]"
            style={{ color: "#41565f" }}
          >
            <span
              style={{
                display: "inline-block",
                width: 6,
                height: 6,
                borderRadius: "50%",
                background: "#c94510",
              }}
            />
            IN YOUR CART
          </span>
        </div>
      </div>

      {/* Compact fallback — shown at max-height: 720px instead of grid */}
      <div className="booking-rail-cal-compact">
        <p className="font-plex-mono text-[12px] m-0" style={{ color: "#5b6f79" }}>
          Scroll the list to browse dates.
        </p>
      </div>
    </div>
  );
}
