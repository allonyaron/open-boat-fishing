import { fmtMonthDay } from "./format";
import type { Trip, VesselInfo } from "./types";

export function FilterBar({
  filter,
  vessels,
  filteredTrips,
  onFilterChange,
}: {
  filter: string;
  vessels: VesselInfo[];
  filteredTrips: Trip[];
  onFilterChange: (f: string) => void;
}) {
  const dates = [...new Set(filteredTrips.map((t) => t.departureDate))].sort();
  const countLabel =
    filteredTrips.length === 0
      ? "NO TRIPS"
      : `${filteredTrips.length} TRIPS${
          dates.length > 0
            ? ` · ${fmtMonthDay(dates[0])} — ${fmtMonthDay(dates[dates.length - 1])}`
            : ""
        }`;

  const chipStyle = (active: boolean) =>
    `font-plex-mono text-[11px] font-semibold tracking-[.14em] cursor-pointer transition-colors flex items-center ${
      active ? "bg-orange text-white" : "bg-transparent text-white hover:border-white/50"
    }`;

  return (
    <div
      className="hull bg-hull-2 hidden lg:flex flex-wrap gap-[10px] items-center justify-between"
      style={{ padding: "10px 24px" }}
    >
      <div className="flex items-center flex-wrap gap-2">
        <span className="font-plex-mono text-[11px] font-semibold tracking-[.14em] text-ink-dark-3 mr-1">
          SHOW
        </span>
        {vessels.length > 1 ? (
          <div role="group" aria-label="Filter by boat" className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => onFilterChange("all")}
              aria-pressed={filter === "all"}
              className={chipStyle(filter === "all")}
              style={{
                border: `1px solid ${filter === "all" ? "#c94510" : "#3c5867"}`,
                padding: "0 16px",
                minHeight: 44,
              }}
            >
              ALL BOATS
            </button>
            {vessels.map((v) => (
              <button
                key={v.name}
                type="button"
                onClick={() => onFilterChange(v.name)}
                aria-pressed={filter === v.name}
                className={chipStyle(filter === v.name)}
                style={{
                  border: `1px solid ${filter === v.name ? "#c94510" : "#3c5867"}`,
                  padding: "0 16px",
                  minHeight: 44,
                }}
              >
                {v.name.toUpperCase()}
              </button>
            ))}
          </div>
        ) : (
          <span className="font-plex-mono text-[11px] font-semibold tracking-[.14em] text-white">
            ALL BOATS
          </span>
        )}
      </div>
      <span className="font-plex-mono text-[12px] tracking-[.1em]" style={{ color: "#c9d6dd" }}>
        {countLabel}
      </span>
    </div>
  );
}
