import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { fmtTimeET } from "@/lib/format";
import { dollars } from "@openboat/utils";
import { fmtDayLong, fmtDayShort, vesselShort } from "./format";
import type { QuoteView } from "@/lib/cart/quote-view";
import type { EnrichedCartItem } from "./types";

const FLASH_MS = 1200;

/**
 * Desktop cart: a full-height column that never moves with the page. The item
 * list scrolls inside it; the total shelf stays at the bottom.
 */
export function CartRail({
  cartItems,
  ready,
  quote,
  totalSeats,
  onRemove,
  onCheckout,
  onOpenDay,
}: {
  cartItems: EnrichedCartItem[];
  /** True once the stored cart has been read, so restoring it isn't taken for adds. */
  ready: boolean;
  quote: QuoteView;
  totalSeats: number;
  onRemove: (tripId: string) => void;
  onCheckout: () => void;
  onOpenDay: (date: string, tripId: string) => void;
}) {
  const hasSeats = totalSeats > 0;
  const listRef = useRef<HTMLUListElement>(null);
  const headingRef = useRef<HTMLSpanElement>(null);
  const [below, setBelow] = useState(0);

  // Items wholly or partly under the fold, for the "↓ N MORE" pill.
  const measure = useCallback(() => {
    const list = listRef.current;
    if (!list) return setBelow(0);
    const bottom = list.scrollTop + list.clientHeight;
    let n = 0;
    for (const li of Array.from(list.children) as HTMLElement[]) {
      if (li.offsetTop + li.offsetHeight > bottom + 1) n++;
    }
    setBelow(n);
  }, []);

  useLayoutEffect(() => {
    measure();
    const list = listRef.current;
    if (!list) return;
    const ro = new ResizeObserver(measure);
    ro.observe(list);
    return () => ro.disconnect();
  }, [measure, cartItems]);

  // After a remove: focus the next item's REMOVE, or the heading once empty.
  const pendingFocus = useRef<string | null>(null);
  function remove(tripId: string) {
    const ids = cartItems.map((i) => i.tripId);
    const idx = ids.indexOf(tripId);
    const rest = ids.filter((id) => id !== tripId);
    pendingFocus.current = rest[Math.min(idx, rest.length - 1)] ?? "";
    onRemove(tripId);
  }
  useEffect(() => {
    const target = pendingFocus.current;
    if (target === null) return;
    pendingFocus.current = null;
    if (target) listRef.current?.querySelector<HTMLButtonElement>(`[data-remove="${target}"]`)?.focus();
    else headingRef.current?.focus();
  }, [cartItems]);

  // After an add: if the item is out of view, scroll the list (never the page)
  // to it and flash its border.
  const seatsSeen = useRef<Map<string, number> | null>(null);
  useEffect(() => {
    if (!ready) return;
    const now = new Map(cartItems.map((i) => [i.tripId, i.tickets.reduce((s, t) => s + t.quantity, 0)]));
    const before = seatsSeen.current;
    seatsSeen.current = now;
    if (!before) return;
    const added = cartItems.find((i) => (now.get(i.tripId) ?? 0) > (before.get(i.tripId) ?? 0));
    const list = listRef.current;
    const li = added && list?.querySelector<HTMLElement>(`[data-cart-item="${added.tripId}"]`);
    if (!list || !li) return;
    const top = li.offsetTop;
    if (top >= list.scrollTop && top + li.offsetHeight <= list.scrollTop + list.clientHeight) return;
    list.scrollTo({ top: Math.max(0, top - 8), behavior: "smooth" });
    li.classList.add("is-flash");
    const timer = setTimeout(() => li.classList.remove("is-flash"), FLASH_MS);
    return () => clearTimeout(timer);
  }, [cartItems, ready]);

  return (
    <aside className="booking-rail" aria-label="Cart">
      <div className="bk-rail-hd">
        <span ref={headingRef} tabIndex={-1} className="bk-rail-heading">
          YOUR SEATS{hasSeats ? ` · ${totalSeats}` : ""}
        </span>
        {cartItems.length > 0 && (
          <span className="bk-rail-sub">
            {cartItems.length} {cartItems.length === 1 ? "TRIP" : "TRIPS"}
          </span>
        )}
      </div>

      <div className={`bk-rail-wrap${below > 0 ? " has-more" : ""}`}>
        {cartItems.length === 0 ? (
          <div className="bk-rail-empty">
            <div className="font-archivo text-[16px] font-bold">No seats yet.</div>
            <div className="font-archivo text-[14px] mt-1" style={{ lineHeight: 1.5, color: "#41565f" }}>
              Pick a day or a trip in the calendar, then hit <strong>+</strong>. Nothing is charged until you
              pay.
            </div>
          </div>
        ) : (
          <>
            <ul
              ref={listRef}
              className="bk-rail-list"
              tabIndex={0}
              aria-label="Your seats"
              onScroll={measure}
            >
              {cartItems.map((item) => (
                <li
                  key={item.tripId}
                  className="bk-cart-item"
                  style={{ ["--vc" as string]: item.vesselColor }}
                  data-cart-item={item.tripId}
                >
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="font-archivo text-[15px] font-bold" style={{ lineHeight: 1.25 }}>
                      {item.productName}
                    </span>
                    <span
                      className="font-plex-mono text-[16px] font-semibold flex-shrink-0"
                      style={{ opacity: quote.updating ? 0.5 : 1 }}
                    >
                      {quote.lineSubtotal(item.tripId)}
                    </span>
                  </div>
                  <button
                    type="button"
                    className="bk-cart-date"
                    onClick={() => onOpenDay(item.departureDate, item.tripId)}
                    title={`Show the trips on ${fmtDayLong(item.departureDate)}`}
                  >
                    {fmtDayShort(item.departureDate)} · {fmtTimeET(item.startTime)} · {vesselShort(item.vesselName)}
                  </button>
                  <div className="bk-cart-fares-row">
                    <span className="font-plex-mono text-[12px] min-w-0" style={{ color: "#41565f" }}>
                      {item.tickets
                        .map((t) => {
                          const lbl = t.displayLabel ?? t.ticketType;
                          return `${t.quantity} × ${lbl.charAt(0).toUpperCase() + lbl.slice(1)} ${dollars(t.priceCents)}`;
                        })
                        .join(" · ")}
                    </span>
                    <button
                      type="button"
                      className="bk-cart-remove"
                      data-remove={item.tripId}
                      onClick={() => remove(item.tripId)}
                      aria-label={`Remove ${item.productName} from cart`}
                    >
                      REMOVE
                    </button>
                  </div>
                </li>
              ))}
            </ul>
            <button
              type="button"
              className="bk-rail-more"
              tabIndex={-1}
              aria-hidden="true"
              onClick={() => {
                const list = listRef.current;
                list?.scrollTo({ top: list.scrollHeight, behavior: "smooth" });
              }}
            >
              ↓ {below} MORE
            </button>
          </>
        )}
      </div>

      <div className="bk-rail-shelf">
        {hasSeats && quote.discountCents > 0 && (
          <div
            className="flex items-baseline justify-between gap-2 mb-2 font-plex-mono text-[13px]"
            style={{ color: "#186a4a", opacity: quote.updating ? 0.5 : 1 }}
          >
            <span className="font-semibold tracking-[.12em]">GROUP DISCOUNT</span>
            <span className="font-semibold">−{dollars(quote.discountCents)}</span>
          </div>
        )}
        <div className="flex items-baseline justify-between gap-2 mb-3">
          <span className="font-plex-mono text-[12px] font-semibold tracking-[.16em]" style={{ color: "#41565f" }}>
            TOTAL
          </span>
          <span
            className="font-plex-mono text-[30px] font-bold"
            aria-busy={quote.updating}
            style={{ lineHeight: 1, color: "#16354a", opacity: quote.updating ? 0.5 : 1 }}
          >
            {hasSeats ? quote.total : dollars(0)}
          </span>
        </div>
        {hasSeats && quote.error && (
          <div role="alert" className="font-archivo text-[13px] font-semibold mb-3" style={{ color: "#8c3b12" }}>
            {quote.error}
          </div>
        )}
        <button
          type="button"
          onClick={hasSeats ? onCheckout : undefined}
          aria-disabled={!hasSeats}
          className="w-full font-archivo text-[16px] font-bold tracking-[.08em] uppercase border-none text-white flex items-center justify-between gap-3"
          style={{
            background: hasSeats ? "#c94510" : "#b9c4c8",
            padding: "19px 20px",
            cursor: hasSeats ? "pointer" : "default",
          }}
        >
          <span>Check out</span>
          <span>{hasSeats ? quote.total : dollars(0)} →</span>
        </button>
        <div className="bk-rail-trust font-plex-mono text-[11px] tracking-[.1em] mt-3 text-center" style={{ color: "#5b6f79", textWrap: "balance" }}>
          FREE CANCELLATION · WEATHER REFUNDS · NO ACCOUNT NEEDED
        </div>
      </div>
    </aside>
  );
}
