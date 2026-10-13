import { useEffect, useLayoutEffect, useRef, type RefObject } from "react";
import { dollars } from "@openboat/utils";
import { fmtTimeET } from "@/lib/format";
import { InlineStepper } from "./InlineStepper";
import { fmtDayLabel, fmtDayLong, fmtDuration, getDisplayPrices, seatState } from "./format";
import type { Trip } from "./types";

const PANEL_W = 460;
const GAP = 8;
const FLASH_MS = 1400;

const SEAT_COLOR = { open: "#186a4a", low: "#8c3b12", full: "#41565f" } as const;

/**
 * The open day's trips with − / +, beside its box in the calendar. Non-modal:
 * the cart rail stays usable while it is open.
 */
export function DayPanel({
  date,
  trips,
  sailingDays,
  focusTripId,
  focusSeq,
  moveFocus,
  bodyRef,
  getQty,
  onAdjustQty,
  onNavigate,
  onClose,
}: {
  date: string;
  trips: Trip[];
  sailingDays: string[];
  /** The trip to outline and bring into view, from a trip line or the cart. */
  focusTripId: string | null;
  /** Changes on every open, so opening the same day again re-runs the focus. */
  focusSeq: number;
  /** False on page load (a deep link), where focus stays put. */
  moveFocus: boolean;
  bodyRef: RefObject<HTMLDivElement>;
  getQty: (tripId: string, ticketType: string) => number;
  onAdjustQty: (tripId: string, ticketType: string, delta: 1 | -1) => void;
  onNavigate: (date: string) => void;
  onClose: () => void;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  // Placement, relative to the calendar grid: right of the box, else left of
  // it, else centred on it; top level with the box, kept inside the grid.
  useLayoutEffect(() => {
    const body = bodyRef.current;
    const panel = panelRef.current;
    if (!body || !panel) return;
    const place = () => {
      const box = body.querySelector<HTMLElement>(`[data-cal-day="${date}"]`);
      if (!box) return;
      const gw = body.clientWidth;
      const gh = body.clientHeight;
      const w = Math.min(PANEL_W, gw - 16);
      panel.style.width = `${w}px`;
      panel.style.maxHeight = `${gh}px`;
      const bl = box.offsetLeft;
      const bw = box.offsetWidth;
      let left = bl + bw + GAP;
      if (left + w > gw) left = bl - GAP - w;
      if (left < 0) left = Math.max(0, Math.min(gw - w, bl + bw / 2 - w / 2));
      const top = Math.max(0, Math.min(box.offsetTop, gh - panel.offsetHeight));
      panel.style.left = `${left}px`;
      panel.style.top = `${top}px`;
      panel.style.visibility = "visible";
    };
    place();
    const ro = new ResizeObserver(place);
    ro.observe(body);
    ro.observe(panel);
    return () => ro.disconnect();
  }, [bodyRef, date, trips.length]);

  // On open: bring the chosen trip into view, tint it, and focus its first
  // enabled +. Opened from a box, focus goes to close (×).
  useEffect(() => {
    const list = listRef.current;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const card = focusTripId
      ? list?.querySelector<HTMLElement>(`[data-trip-card="${focusTripId}"]`)
      : null;
    if (list && card) {
      list.scrollTop = card.offsetTop - 12;
      card.classList.add("is-flash");
      timer = setTimeout(() => card.classList.remove("is-flash"), FLASH_MS);
    }
    if (moveFocus) {
      const plus = card?.querySelector<HTMLButtonElement>('button[aria-label^="One more"]:not(:disabled)');
      (plus ?? closeRef.current)?.focus({ preventScroll: true });
    }
    return () => clearTimeout(timer);
    // Runs once per open (focusSeq), not when the trips re-render.
  }, [focusSeq]);

  const { main, sub } = fmtDayLabel(date);
  const i = sailingDays.indexOf(date);
  const prev = i > 0 ? sailingDays[i - 1] : null;
  const next = i >= 0 && i < sailingDays.length - 1 ? sailingDays[i + 1] : null;

  function step(to: string | null, e: React.MouseEvent<HTMLButtonElement>) {
    if (!to) return;
    const btn = e.currentTarget;
    onNavigate(to);
    // At the first or last day the button disables; keep focus in the panel.
    requestAnimationFrame(() => {
      if (btn.disabled) closeRef.current?.focus();
    });
  }

  return (
    <div
      ref={panelRef}
      className="bk-panel"
      role="dialog"
      aria-label={`Trips on ${fmtDayLong(date)}`}
      data-day-panel
      style={{ visibility: "hidden" }}
    >
      <div className="bk-panel-hd hull">
        <div className="bk-panel-title">
          {main}
          <span>
            {sub ? `${sub} · ` : ""}
            {trips.length} TRIP{trips.length === 1 ? "" : "S"}
          </span>
        </div>
        <button
          type="button"
          className="bk-panel-btn"
          onClick={(e) => step(prev, e)}
          disabled={!prev}
          aria-label="Previous sailing day"
        >
          ‹
        </button>
        <button
          type="button"
          className="bk-panel-btn"
          onClick={(e) => step(next, e)}
          disabled={!next}
          aria-label="Next sailing day"
        >
          ›
        </button>
        <button
          ref={closeRef}
          type="button"
          className="bk-panel-btn"
          onClick={onClose}
          aria-label="Close"
        >
          ×
        </button>
      </div>
      <div ref={listRef} className="bk-panel-body">
        {trips.map((trip) => (
          <PanelTrip
            key={trip.id}
            trip={trip}
            outlined={trip.id === focusTripId}
            getQty={getQty}
            onAdjustQty={onAdjustQty}
          />
        ))}
      </div>
    </div>
  );
}

function PanelTrip({
  trip,
  outlined,
  getQty,
  onAdjustQty,
}: {
  trip: Trip;
  outlined: boolean;
  getQty: (tripId: string, ticketType: string) => number;
  onAdjustQty: (tripId: string, ticketType: string, delta: 1 | -1) => void;
}) {
  const state = seatState(trip);
  const soldOut = state.kind === "full";
  const displayPrices = getDisplayPrices(trip.product.prices);
  const totalQty = displayPrices.reduce((sum, p) => sum + getQty(trip.id, p.ticketType), 0);
  const inCart = totalQty > 0;

  return (
    <div
      className={`bk-ptrip${inCart ? " is-in" : ""}${soldOut ? " is-soldout" : ""}${outlined ? " is-focus" : ""}`}
      style={{ ["--vc" as string]: trip.vessel.color }}
      data-trip-card={trip.id}
    >
      <div className="bk-ptrip-top">
        <span className="bk-ptrip-kicker">{trip.product.category.toUpperCase()}</span>
        <span className="bk-ptrip-seats" style={{ color: SEAT_COLOR[state.kind] }}>
          {state.label}
        </span>
      </div>
      <div className="bk-ptrip-name">{trip.product.displayName}</div>
      <div className="bk-ptrip-meta">
        {fmtTimeET(trip.startTime)} – {fmtTimeET(trip.endTime)} ·{" "}
        {fmtDuration(trip.startTime, trip.endTime)} · {trip.vessel.name}
      </div>
      <div className="bk-ptrip-fares">
        {soldOut ? (
          <button type="button" className="bk-waitlist">
            WAITLIST
          </button>
        ) : (
          displayPrices.map((price) => {
            const qty = getQty(trip.id, price.ticketType);
            const otherQty = totalQty - qty;
            const atMax = qty >= trip.seatsRemaining - otherQty;
            const label = price.displayLabel ?? price.ticketType;
            return (
              <div key={price.ticketType} className="flex items-center justify-between gap-3">
                <div>
                  <div className="font-archivo text-[15px] font-bold">
                    {label.charAt(0).toUpperCase() + label.slice(1)}
                  </div>
                  <div className="font-plex-mono text-[13px]" style={{ color: "#41565f" }}>
                    {dollars(price.priceCents)} each
                  </div>
                </div>
                <InlineStepper
                  value={qty}
                  onDec={() => onAdjustQty(trip.id, price.ticketType, -1)}
                  onInc={() => onAdjustQty(trip.id, price.ticketType, 1)}
                  atMax={atMax}
                  decLabel={`One fewer ${label} seat`}
                  incLabel={`One more ${label} seat`}
                />
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
