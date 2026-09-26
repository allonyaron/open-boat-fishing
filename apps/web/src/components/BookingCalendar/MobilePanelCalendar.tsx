import { MONTHS, parseMonth } from "./format";
import type { Trip } from "./types";

export function MobilePanelCalendar({
  month,
  byDate,
  selectedDay,
  cartDates,
  canPrevMonth,
  canNextMonth,
  onDaySelect,
  onPrevMonth,
  onNextMonth,
}: {
  month: string;
  byDate: Record<string, Trip[]>;
  selectedDay: string | null;
  cartDates: Set<string>;
  canPrevMonth: boolean;
  canNextMonth: boolean;
  onDaySelect: (date: string) => void;
  onPrevMonth: () => void;
  onNextMonth: () => void;
}) {
  const todayStr = new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });
  const { year, mon } = parseMonth(month);
  const monthLabel = `${MONTHS[mon - 1].toUpperCase()} ${year}`;
  const firstDow = new Date(Date.UTC(year, mon - 1, 1)).getUTCDay();
  const lastDay = new Date(Date.UTC(year, mon, 0)).getUTCDate();
  const days = Array.from({ length: lastDay }, (_, i) =>
    `${month}-${String(i + 1).padStart(2, "0")}`
  );
  const cells: (string | null)[] = [...Array(firstDow).fill(null), ...days];
  while (cells.length % 7 !== 0) cells.push(null);

  const btnBorder = (enabled: boolean) => ({
    width: 44,
    height: 40,
    display: "flex" as const,
    alignItems: "center" as const,
    justifyContent: "center" as const,
    background: "#fff",
    border: `1px solid ${enabled ? "#16354a" : "#e3e9eb"}`,
    color: enabled ? "#16354a" : "#b9c3c7",
    fontSize: 16,
    cursor: enabled ? "pointer" as const : "default" as const,
  });

  return (
    <div
      className="bg-white"
      style={{ borderBottom: "1px solid #cdd6da", padding: "14px 16px" }}
    >
      {/* Month nav */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <button type="button" onClick={canPrevMonth ? onPrevMonth : undefined} style={btnBorder(canPrevMonth)} aria-label="Previous month">‹</button>
        <span className="font-plex-mono font-semibold" style={{ fontSize: 14, letterSpacing: ".12em", color: "#16354a" }}>
          {monthLabel}
        </span>
        <button type="button" onClick={canNextMonth ? onNextMonth : undefined} style={btnBorder(canNextMonth)} aria-label="Next month">›</button>
      </div>

      {/* Grid */}
      <div style={{ marginTop: 14 }}>
        {/* Weekday headers */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", paddingBottom: 4 }}>
          {["S","M","T","W","T","F","S"].map((d, i) => (
            <div key={i} className="font-plex-mono" style={{ fontSize: 10, fontWeight: 500, letterSpacing: ".08em", color: "#c9d6dd", textAlign: "center" }}>{d}</div>
          ))}
        </div>
        {/* Day cells */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 3 }}>
          {cells.map((date, i) => {
            if (!date) return <div key={`e-${i}`} style={{ height: 44 }} />;
            const isPast = date < todayStr;
            const hasSailings = (byDate[date]?.length ?? 0) > 0;
            const inCart = cartDates.has(date);
            const isSelected = date === selectedDay;
            const dayNum = parseInt(date.slice(-2));

            let bg = "transparent";
            let textColor = "#9aa8ae";
            let dotColor: string | null = null;
            let boxShadow = "none";

            if (isPast) {
              bg = "#e6ebeb";
              textColor = "#8a999f";
            } else if (hasSailings) {
              bg = isSelected ? "#16354a" : "#fff";
              textColor = isSelected ? "#fff" : "#16354a";
              dotColor = isSelected ? "#c9d6dd" : inCart ? "#c94510" : "#16354a";
              if (!isSelected) boxShadow = "inset 0 0 0 1px #cdd6da";
            }

            return (
              <button
                key={date}
                type="button"
                onClick={() => !isPast && hasSailings && onDaySelect(date)}
                disabled={isPast || !hasSailings}
                aria-pressed={isSelected}
                style={{
                  height: 44,
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 3,
                  background: bg,
                  boxShadow,
                  border: "none",
                  cursor: !isPast && hasSailings ? "pointer" : "default",
                  padding: 0,
                }}
              >
                <span className="font-plex-mono font-semibold" style={{ fontSize: 14, lineHeight: 1, color: textColor }}>{dayNum}</span>
                {dotColor && (
                  <span style={{ display: "block", width: 4, height: 4, borderRadius: "50%", background: dotColor, flexShrink: 0 }} />
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Legend */}
      <div style={{ display: "flex", alignItems: "center", gap: 16, marginTop: 14 }}>
        <span className="flex items-center gap-[6px] font-plex-mono" style={{ fontSize: 10, fontWeight: 500, letterSpacing: ".08em", color: "#41565f" }}>
          <span style={{ display: "inline-block", width: 6, height: 6, borderRadius: "50%", background: "#16354a" }} />
          SAILING
        </span>
        <span className="flex items-center gap-[6px] font-plex-mono" style={{ fontSize: 10, fontWeight: 500, letterSpacing: ".08em", color: "#41565f" }}>
          <span style={{ display: "inline-block", width: 6, height: 6, borderRadius: "50%", background: "#c94510" }} />
          IN YOUR CART
        </span>
        <span className="flex items-center gap-[6px] font-plex-mono" style={{ fontSize: 10, fontWeight: 500, letterSpacing: ".08em", color: "#8a999f" }}>
          <span style={{ display: "inline-block", width: 8, height: 8, background: "#e6ebeb" }} />
          PAST
        </span>
      </div>
    </div>
  );
}
