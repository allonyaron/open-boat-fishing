import { fmtDayLabel } from "./format";
import { TripRow } from "./TripRow";
import type { Trip } from "./types";

export function DayGroup({
  dateStr,
  trips,
  getQty,
  onAdjustQty,
  headerH,
}: {
  dateStr: string;
  trips: Trip[];
  getQty: (tripId: string, ticketType: string) => number;
  onAdjustQty: (tripId: string, ticketType: string, delta: 1 | -1) => void;
  headerH: number;
}) {
  const { main, sub } = fmtDayLabel(dateStr);
  const dayNum = parseInt(dateStr.slice(-2));
  return (
    <div id={`day-${dayNum}`} style={{ paddingTop: 26, scrollMarginTop: headerH + 16 }}>
      <div
        className="flex items-baseline gap-3 pb-2 bg-deck"
        style={{
          borderBottom: "2px solid #cdd6da",
          position: "sticky",
          top: headerH,
          zIndex: 2,
        }}
      >
        <span className="font-plex-mono text-[13px] font-semibold tracking-[.14em] uppercase">
          {main}
        </span>
        {sub && (
          <span
            className="font-plex-mono text-[12px] tracking-[.08em]"
            style={{ color: "#5b6f79" }}
          >
            {sub}
          </span>
        )}
      </div>
      {trips.map((trip) => (
        <TripRow key={trip.id} trip={trip} getQty={getQty} onAdjustQty={onAdjustQty} />
      ))}
    </div>
  );
}
