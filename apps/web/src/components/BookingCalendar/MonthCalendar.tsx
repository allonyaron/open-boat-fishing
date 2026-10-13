import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode, type RefObject } from "react";
import { EmptyState } from "./EmptyState";
import { MONTHS, fmtDayLong, fmtLineTimeET, parseMonth, seatState } from "./format";
import { fmtTimeET } from "@/lib/format";
import type { Trip } from "./types";

const DOW = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];

// A trip line is 14px tall with a 2px gap; the box's padding, date row and the
// list's top margin take 34px.
const LINE_PITCH = 16;
const BOX_CHROME = 34;
/** Lines per box before the grid has been measured (the 1280×800 value). */
const DEFAULT_LINES = 4;

/**
 * Desktop /book: the month as a full-height grid. Each day box lists its trips
 * as lines; the box, a line or "+N MORE" all open the day panel. Nothing here
 * adds to the cart.
 */
export function MonthCalendar({
  month,
  byDate,
  sailingDays,
  todayStr,
  cartTripIds,
  openDate,
  canPrevMonth,
  loading,
  bodyRef,
  onPrevMonth,
  onNextMonth,
  onOpenDay,
  children,
}: {
  month: string;
  byDate: Record<string, Trip[]>;
  /** The month's bookable days, sorted. */
  sailingDays: string[];
  todayStr: string;
  cartTripIds: Set<string>;
  openDate: string | null;
  canPrevMonth: boolean;
  loading: boolean;
  /** The grid's positioning box; the day panel is placed inside it. */
  bodyRef: RefObject<HTMLDivElement>;
  onPrevMonth: () => void;
  onNextMonth: () => void;
  onOpenDay: (date: string, tripId?: string) => void;
  /** The day panel. */
  children?: ReactNode;
}) {
  const { year, mon } = parseMonth(month);
  const firstDow = new Date(Date.UTC(year, mon - 1, 1)).getUTCDay();
  const lastDay = new Date(Date.UTC(year, mon, 0)).getUTCDate();
  const cells: (string | null)[] = [
    ...Array<null>(firstDow).fill(null),
    ...Array.from({ length: lastDay }, (_, i) => `${month}-${String(i + 1).padStart(2, "0")}`),
  ];
  while (cells.length % 7 !== 0) cells.push(null);
  const weeks = cells.length / 7;

  // How many lines fit is measured from a box, so it follows the window.
  const gridRef = useRef<HTMLDivElement>(null);
  const [linesPerBox, setLinesPerBox] = useState(DEFAULT_LINES);
  useEffect(() => {
    const grid = gridRef.current;
    if (!grid) return;
    const measure = () => {
      const box = grid.firstElementChild as HTMLElement | null;
      if (!box || box.clientHeight === 0) return;
      setLinesPerBox(Math.max(1, Math.floor((box.clientHeight - BOX_CHROME) / LINE_PITCH)));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(grid);
    return () => ro.disconnect();
  }, [weeks]);

  // Roving tabindex: the grid is one tab stop; arrow keys move between days.
  const [rovingDate, setRovingDate] = useState<string | null>(null);
  const tabDate =
    [openDate, rovingDate].find((d) => d && sailingDays.includes(d)) ?? sailingDays[0] ?? null;

  function focusDay(date: string) {
    setRovingDate(date);
    gridRef.current
      ?.querySelector<HTMLButtonElement>(`button[data-day-hit="${date}"]`)
      ?.focus();
  }

  function onGridKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    const from = (e.target as HTMLElement).dataset.dayHit;
    if (!from) return;
    const i = sailingDays.indexOf(from);
    let to: string | undefined;
    if (e.key === "ArrowRight") to = sailingDays[i + 1];
    else if (e.key === "ArrowLeft") to = sailingDays[i - 1];
    else if (e.key === "Home") to = sailingDays[0];
    else if (e.key === "End") to = sailingDays[sailingDays.length - 1];
    else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      // Same weekday a week away; skip weeks with no sailing that day.
      const step = e.key === "ArrowDown" ? 7 : -7;
      const idx = cells.indexOf(from);
      for (let j = idx + step; j >= 0 && j < cells.length; j += step) {
        const d = cells[j];
        if (d && sailingDays.includes(d)) {
          to = d;
          break;
        }
      }
    } else return;
    e.preventDefault();
    if (to) focusDay(to);
  }

  return (
    <div className="bk-cal">
      <div className="bk-cal-hd">
        <div className="bk-cal-nav">
          <button
            type="button"
            className="bk-navbtn"
            onClick={onPrevMonth}
            disabled={!canPrevMonth || loading}
            aria-label="Previous month"
          >
            ‹
          </button>
          <h2 className="bk-cal-title" aria-live="polite">
            {MONTHS[mon - 1].toUpperCase()} {year}
          </h2>
          <button
            type="button"
            className="bk-navbtn"
            onClick={onNextMonth}
            disabled={loading}
            aria-label="Next month"
          >
            ›
          </button>
        </div>
        <div className="bk-legend" aria-hidden="true">
          <span className="bk-legend-low">8 = 10 OR FEWER LEFT</span>
          <span className="bk-legend-full">FULL</span>
          <span>
            <i className="bk-legend-cart" />
            IN CART
          </span>
        </div>
      </div>

      <div className="bk-cal-dow" aria-hidden="true">
        {DOW.map((d) => (
          <div key={d}>{d}</div>
        ))}
      </div>

      <div
        ref={bodyRef}
        className={`bk-cal-body transition-opacity ${loading ? "opacity-40 pointer-events-none" : ""}`}
        aria-busy={loading}
      >
        <div
          ref={gridRef}
          className="bk-cal-grid"
          style={{ gridTemplateRows: `repeat(${weeks}, minmax(0, 1fr))` }}
          onKeyDown={onGridKeyDown}
        >
          {cells.map((date, i) => {
            if (!date) return <div key={`e-${i}`} />;
            const past = date < todayStr;
            const trips = past ? [] : byDate[date] ?? [];
            return (
              <DayBox
                key={date}
                date={date}
                trips={trips}
                past={past}
                today={date === todayStr}
                open={date === openDate}
                tabbable={date === tabDate}
                linesPerBox={linesPerBox}
                cartTripIds={cartTripIds}
                onOpenDay={(d, tripId) => {
                  setRovingDate(d);
                  onOpenDay(d, tripId);
                }}
              />
            );
          })}
        </div>
        {sailingDays.length === 0 && !loading && (
          <div className="bk-cal-empty">
            <EmptyState onNextMonth={onNextMonth} />
          </div>
        )}
        {children}
      </div>
    </div>
  );
}

function DayBox({
  date,
  trips,
  past,
  today,
  open,
  tabbable,
  linesPerBox,
  cartTripIds,
  onOpenDay,
}: {
  date: string;
  trips: Trip[];
  past: boolean;
  today: boolean;
  open: boolean;
  tabbable: boolean;
  linesPerBox: number;
  cartTripIds: Set<string>;
  onOpenDay: (date: string, tripId?: string) => void;
}) {
  const n = trips.length;
  const inCart = trips.some((t) => cartTripIds.has(t.id));
  const shown = n <= linesPerBox ? n : Math.max(0, linesPerBox - 1);
  const state = past ? "is-past" : n > 0 ? "is-sail" : "is-none";
  const dayNum = parseInt(date.slice(-2), 10);

  return (
    <div
      className={`bk-day ${state}${today ? " is-today" : ""}${open ? " is-open" : ""}`}
      data-cal-day={date}
    >
      {n > 0 && (
        <button
          type="button"
          className="bk-day-hit"
          data-day-hit={date}
          tabIndex={tabbable ? 0 : -1}
          aria-label={`${fmtDayLong(date)}: ${n} trip${n === 1 ? "" : "s"}${inCart ? ", in your cart" : ""}`}
          aria-haspopup="dialog"
          aria-expanded={open}
          onClick={() => onOpenDay(date)}
        />
      )}
      <div className="bk-day-hd">
        <span className="bk-day-num">
          {dayNum}
          {today && <span className="bk-day-today"> TODAY</span>}
        </span>
        {inCart && <span className="bk-day-dot" title="In your cart" />}
      </div>
      {n > 0 && (
        <ul className="bk-lines">
          {trips.slice(0, shown).map((t) => {
            const s = seatState(t);
            return (
              <li key={t.id}>
                <button
                  type="button"
                  tabIndex={-1}
                  className={`bk-line is-${s.kind}${cartTripIds.has(t.id) ? " is-in" : ""}`}
                  style={{ ["--vc" as string]: t.vessel.color }}
                  aria-label={`${fmtTimeET(t.startTime)} ${t.product.displayName}, ${s.label.toLowerCase()}`}
                  onClick={() => onOpenDay(date, t.id)}
                >
                  <span className="bk-line-time">{fmtLineTimeET(t.startTime)}</span>
                  <span className="bk-line-name">{t.product.category.toUpperCase()}</span>
                  {s.count && <span className="bk-line-count">{s.count}</span>}
                </button>
              </li>
            );
          })}
          {n > shown && (
            <li>
              <button
                type="button"
                tabIndex={-1}
                className="bk-line is-more"
                onClick={() => onOpenDay(date)}
              >
                +{n - shown} MORE
              </button>
            </li>
          )}
        </ul>
      )}
    </div>
  );
}
