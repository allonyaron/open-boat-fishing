import { MONTHS, parseMonth } from "./format";
import type { ViewMode, VesselInfo } from "./types";

export function FilterBar({
  month,
  view,
  filter,
  vessels,
  onPrevMonth,
  onNextMonth,
  onViewChange,
  onFilterChange,
  announceRef,
}: {
  month: string;
  view: ViewMode;
  filter: string;
  vessels: VesselInfo[];
  onPrevMonth: () => void;
  onNextMonth: () => void;
  onViewChange: (v: ViewMode) => void;
  onFilterChange: (f: string) => void;
  announceRef: React.RefObject<HTMLDivElement | null>;
}) {
  const { year, mon } = parseMonth(month);
  const monthLabel = `${MONTHS[mon - 1].toUpperCase()} ${year}`;

  function handlePrev() {
    onPrevMonth();
    if (announceRef.current) announceRef.current.textContent = `Showing ${MONTHS[mon - 2 < 0 ? 11 : mon - 2]} ${mon - 2 < 0 ? year - 1 : year}`;
  }
  function handleNext() {
    onNextMonth();
    if (announceRef.current) announceRef.current.textContent = `Showing ${MONTHS[mon % 12]} ${mon === 12 ? year + 1 : year}`;
  }

  const viewChipStyle = (active: boolean) =>
    `px-[18px] font-plex-mono text-[13px] font-semibold tracking-[.1em] cursor-pointer border transition-colors min-h-[44px] flex items-center ${
      active
        ? "bg-white text-hull border-white"
        : "bg-transparent text-ink-dark-2 border-hull-line hover:text-white"
    }`;
  const filterChipStyle = (active: boolean) =>
    `px-[16px] font-plex-mono text-[13px] font-semibold tracking-[.1em] cursor-pointer border transition-colors min-h-[44px] flex items-center gap-[6px] ${
      active
        ? "bg-orange border-orange text-white"
        : "bg-transparent border-hull-line text-white hover:border-white/50"
    }`;

  const showVesselFilter = vessels.length > 1;

  return (
    <div className="hull bg-hull-2 flex flex-wrap gap-[14px] items-center justify-between" style={{ padding: "12px 24px" }}>
      {/* Month stepper */}
      <div className="flex items-center gap-[10px]">
        <button
          type="button"
          onClick={handlePrev}
          aria-label="Previous month"
          className="flex items-center justify-center bg-transparent text-[#dfe8ec] cursor-pointer hover:text-white transition-colors"
          style={{ width: 44, height: 44, border: "1px solid #3c5867", fontSize: 18 }}
        >
          ‹
        </button>
        <span className="font-plex-mono text-[15px] font-semibold tracking-[.12em] text-white text-center" style={{ minWidth: 190 }}>
          {monthLabel}
        </span>
        <button
          type="button"
          onClick={handleNext}
          aria-label="Next month"
          className="flex items-center justify-center bg-transparent text-[#dfe8ec] cursor-pointer hover:text-white transition-colors"
          style={{ width: 44, height: 44, border: "1px solid #3c5867", fontSize: 18 }}
        >
          ›
        </button>
      </div>

      <div className="flex flex-wrap gap-[18px] items-center">
        {/* View toggle */}
        <div role="group" aria-label="View" className="flex">
          <button type="button" onClick={() => onViewChange("list")} aria-pressed={view === "list"} className={viewChipStyle(view === "list")}>LIST</button>
          <button type="button" onClick={() => onViewChange("calendar")} aria-pressed={view === "calendar"} className={viewChipStyle(view === "calendar")}>CALENDAR</button>
        </div>
        {/* Vessel filter — hidden when only 1 vessel */}
        {showVesselFilter && (
          <div role="group" aria-label="Filter by boat" className="flex flex-wrap gap-2">
            <button type="button" onClick={() => onFilterChange("all")} aria-pressed={filter === "all"} className={filterChipStyle(filter === "all")}>
              ALL
            </button>
            {vessels.map((v) => (
              <button
                key={v.name}
                type="button"
                onClick={() => onFilterChange(v.name)}
                aria-pressed={filter === v.name}
                className={filterChipStyle(filter === v.name)}
              >
                <span
                  aria-hidden="true"
                  className="inline-block rounded-full flex-shrink-0"
                  style={{ width: 7, height: 7, background: filter === v.name ? "#fff" : v.color }}
                />
                {v.name.toUpperCase()}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
