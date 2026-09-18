import { useEffect, useState } from "react";
import { fmtTimeET } from "@/lib/format";
import { InlineStepper } from "./InlineStepper";
import { dollars, fmtDayLabel, getDisplayPrices, pluralLabel } from "./format";
import type { EnrichedCartItem, Trip } from "./types";

export function CartRail({
  cartItems,
  totalCents,
  totalSeats,
  selectedDay,
  selectedTripId,
  dayTrips,
  getQty,
  onAdjustQty,
  onRemove,
  onCheckout,
  tripCardRefs,
  scrollRef,
  footerRef,
  headerH,
  announceRef,
}: {
  cartItems: EnrichedCartItem[];
  totalCents: number;
  totalSeats: number;
  selectedDay: string | null;
  selectedTripId: string | null;
  dayTrips: Trip[];
  getQty: (tripId: string, ticketType: string) => number;
  onAdjustQty: (tripId: string, ticketType: string, delta: 1 | -1) => void;
  onRemove: (tripId: string) => void;
  onCheckout: () => void;
  tripCardRefs: React.MutableRefObject<Map<string, HTMLDivElement>>;
  scrollRef: React.RefObject<HTMLDivElement | null>;
  footerRef: React.RefObject<HTMLDivElement | null>;
  headerH: number;
  announceRef: React.RefObject<HTMLDivElement | null>;
}) {
  const [footerH, setFooterH] = useState(0);

  useEffect(() => {
    const footer = footerRef.current;
    if (!footer) return;
    const measure = () => setFooterH(footer.offsetHeight);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(footer);
    return () => ro.disconnect();
  }, [footerRef]);

  const hasDay = selectedDay && dayTrips.length > 0;

  return (
    <div
      className="booking-rail"
      style={{
        borderLeft: "2px solid #cdd6da",
        background: "#f8f4f4",
        position: "sticky",
        top: headerH,
        height: `calc(100vh - ${headerH}px - ${footerH}px)`,
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
      }}
    >
      {/* ── Top: day trips (scrollable) ── */}
      <div ref={scrollRef} style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "20px 20px 8px" }}>

        {hasDay ? (
          <div style={{ marginBottom: 16 }}>
            <h2 style={{ fontSize: 16, letterSpacing: "0.1em", textTransform: "uppercase", margin: "0 0 4px", color: "#201e1d" }}>
              {fmtDayLabel(selectedDay!).main.replace(/,\s*/, ", ")}
            </h2>
            <div style={{ fontSize: 13, color: "#444141", marginBottom: 12 }}>
              {dayTrips.length} {dayTrips.length === 1 ? "trip" : "trips"} · pick a departure and add seats below
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {dayTrips.map((trip) => {
                const displayPrices = getDisplayPrices(trip.product.prices);
                const soldOut = trip.seatsRemaining === 0;
                const totalQty = displayPrices.reduce((s, p) => s + getQty(trip.id, p.ticketType), 0);
                const inCart = totalQty > 0;
                const isFocused = trip.id === selectedTripId;
                return (
                  <div
                    key={`pick-${trip.id}`}
                    ref={(el) => {
                      if (el) tripCardRefs.current.set(trip.id, el);
                      else tripCardRefs.current.delete(trip.id);
                    }}
                    style={{
                      background: isFocused ? "#fdf1ec" : "#ffffff",
                      border: `${isFocused || inCart ? "2px" : "1px"} solid ${isFocused || inCart ? "#d1541f" : "#cdd6da"}`,
                      padding: "14px 16px",
                      opacity: soldOut ? 0.55 : 1,
                    }}
                  >
                    <div className="font-plex-mono text-[12px] tracking-[.16em] mb-[3px]" style={{ color: "#9a3c12" }}>
                      {trip.product.category.toUpperCase()}
                    </div>
                    <div className="flex items-baseline justify-between gap-2 mb-1">
                      <div className="font-archivo text-[16px] font-bold leading-tight">{trip.product.displayName}</div>
                      {!soldOut && trip.product.showRemaining && trip.seatsRemaining <= 10 && (
                        <div className="font-plex-mono text-[13px] font-semibold flex-shrink-0" style={{ color: "#9a3c12" }}>
                          {trip.seatsRemaining} LEFT
                        </div>
                      )}
                    </div>
                    <div className="font-plex-mono text-[13px] mb-3" style={{ color: "#444141" }}>
                      {fmtTimeET(trip.startTime)} – {fmtTimeET(trip.endTime)} · {trip.vessel.name}
                    </div>
                    {soldOut ? (
                      <div className="font-plex-mono text-[12px]" style={{ color: "#9aa8ae" }}>SOLD OUT</div>
                    ) : (
                      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                        {displayPrices.map((price) => {
                          const qty = getQty(trip.id, price.ticketType);
                          const otherQty = displayPrices
                            .filter((p) => p.ticketType !== price.ticketType)
                            .reduce((s, p) => s + getQty(trip.id, p.ticketType), 0);
                          const atMax = qty >= trip.seatsRemaining - otherQty;
                          const label = price.displayLabel ?? price.ticketType;
                          return (
                            <div key={price.ticketType} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
                              <div style={{ fontSize: 14, color: "#201e1d" }}>
                                {label.charAt(0).toUpperCase() + label.slice(1)}
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
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        ) : (
          <div style={{ border: "1px dashed #7d7979", background: "#f3f2f2", padding: "20px 18px" }}>
            <div style={{ fontSize: 17, fontWeight: 800 }}>No day chosen yet.</div>
            <div style={{ fontSize: 14, color: "#444141", marginTop: 6, lineHeight: 1.5 }}>
              Pick a day on the calendar and every trip sailing that day lands here — departure window, boat, seats left and its own fare.
            </div>
          </div>
        )}
      </div>

      {/* ── Bottom: Your seats (permanent) ── */}
      <div style={{ flexShrink: 0, borderTop: "2px solid #d7d3d3", background: "#f8f4f4" }}>
        <h2 style={{ fontSize: 14, letterSpacing: "0.14em", textTransform: "uppercase", margin: 0, padding: "14px 20px 10px", color: "#201e1d" }}>
          Your seats
        </h2>
        <div style={{ padding: "0 20px", maxHeight: 260, overflowY: "auto" }}>

          {cartItems.length === 0 ? (
            <div style={{ border: "1px dashed #7d7979", padding: "18px 16px", background: "transparent", marginBottom: 14 }}>
              <div className="text-[16px] font-bold font-archivo">No seats yet.</div>
              <div className="text-[14px] mt-1" style={{ lineHeight: 1.5, color: "#444141" }}>
                Pick a day, then hit <strong>+</strong> on a trip.
              </div>
            </div>
          ) : (
            <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column" }}>
              {cartItems.map((item) => {
                const subtotal = item.tickets.reduce((s, t) => s + t.quantity * t.priceCents, 0);
                const seatsLabel = item.tickets
                  .map((t) => {
                    const lbl = t.displayLabel ?? t.ticketType;
                    return `${t.quantity} ${pluralLabel(lbl, t.quantity)}`;
                  })
                  .join(" · ");
                const dateShort = new Date(item.departureDate + "T12:00:00Z").toLocaleDateString("en-US", {
                  month: "short", day: "numeric", timeZone: "UTC",
                });
                return (
                  <li
                    key={`cart-${item.tripId}`}
                    style={{ padding: "12px 0", borderBottom: "1px solid #d7d3d3" }}
                  >
                    <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12 }}>
                      <div className="font-archivo text-[15px] font-bold">{item.productName}</div>
                      <div className="font-plex-mono text-[15px] font-bold flex-shrink-0">{dollars(subtotal)}</div>
                    </div>
                    <div className="font-plex-mono text-[13px] mt-[2px]" style={{ color: "#444141" }}>
                      {dateShort} · {fmtTimeET(item.startTime)}
                    </div>
                    <div className="font-plex-mono text-[13px]" style={{ color: "#201e1d" }}>
                      {seatsLabel}
                    </div>
                    <button
                      type="button"
                      onClick={() => onRemove(item.tripId)}
                      aria-label={`Remove ${item.productName} from cart`}
                      className="font-plex-mono text-[13px] font-semibold tracking-[.06em] cursor-pointer bg-transparent border-none mt-[3px] underline"
                      style={{ color: "#9a3c12", padding: "6px 0", minHeight: 44, display: "block" }}
                    >
                      REMOVE
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {/* Checkout */}
        {cartItems.length > 0 && (
          <div style={{ padding: "14px 20px 20px", borderTop: "2px solid #201e1d", background: "#f3f2f2" }}>
            <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12 }}>
              <div className="font-plex-mono text-[14px] tracking-[.14em] uppercase" style={{ color: "#444141" }}>Total</div>
              <div className="font-plex-mono text-[34px] font-bold" style={{ lineHeight: 1 }}>{dollars(totalCents)}</div>
            </div>
            <div className="font-plex-mono text-[13px] mt-1" style={{ color: "#444141" }}>
              {totalSeats} {totalSeats === 1 ? "seat" : "seats"}
            </div>
            <button
              type="button"
              onClick={onCheckout}
              className="w-full bg-orange text-white font-archivo text-[17px] font-bold tracking-[.06em] uppercase cursor-pointer hover:bg-orange-press transition-colors border-none flex items-center justify-between gap-3 mt-[14px]"
              style={{ padding: "0 18px", minHeight: 56 }}
            >
              <span>CHECK OUT</span>
              <span>{dollars(totalCents)} →</span>
            </button>
            <div className="font-plex-mono text-[13px] mt-[10px]" style={{ lineHeight: 1.7, color: "#201e1d" }}>
              Pay in full now · Free cancellation up to 24h before departure · Automatic refund if weather cancels the trip.
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
