import { fmtDayLabel } from "./format";
import { TripRow } from "./TripRow";
import type { Trip } from "./types";

export function DayGroup({
  dateStr,
  trips,
  getQty,
  onAdjustQty,
}: {
  dateStr: string;
  trips: Trip[];
  getQty: (tripId: string, ticketType: string) => number;
  onAdjustQty: (tripId: string, ticketType: string, delta: 1 | -1) => void;
}) {
  const { main, sub } = fmtDayLabel(dateStr);
  return (
    <div style={{ paddingTop: 26 }}>
      <div className="flex items-baseline gap-3 pb-2" style={{ borderBottom: "2px solid #cdd6da" }}>
        <span className="font-plex-mono text-[13px] font-semibold tracking-[.14em] uppercase">
          {main}
        </span>
        {sub && (
          <span className="font-plex-mono text-[12px] tracking-[.08em]" style={{ color: "#444141" }}>{sub}</span>
        )}
      </div>
      {trips.map((trip) => (
        <TripRow key={trip.id} trip={trip} getQty={getQty} onAdjustQty={onAdjustQty} />
      ))}
    </div>
  );
}
