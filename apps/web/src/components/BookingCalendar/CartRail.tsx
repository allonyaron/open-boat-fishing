import { fmtTimeET } from "@/lib/format";
import { RailCalendar } from "./RailCalendar";
import { dollars, fmtHoldTime } from "./format";
import type { EnrichedCartItem, Trip } from "./types";

export function CartRail({
  cartItems,
  totalCents,
  totalSeats,
  holdSecs,
  month,
  byDate,
  selectedDay,
  cartDates,
  headerH,
  onRemove,
  onCheckout,
  onDaySelect,
  onPrevMonth,
  onNextMonth,
}: {
  cartItems: EnrichedCartItem[];
  totalCents: number;
  totalSeats: number;
  holdSecs: number | null;
  month: string;
  byDate: Record<string, Trip[]>;
  selectedDay: string | null;
  cartDates: Set<string>;
  headerH: number;
  onRemove: (tripId: string) => void;
  onCheckout: () => void;
  onDaySelect: (date: string) => void;
  onPrevMonth: () => void;
  onNextMonth: () => void;
}) {
  const hasSeats = totalSeats > 0;
  const isExpired = holdSecs !== null && holdSecs <= 0;
  const isWarning = holdSecs !== null && holdSecs > 0 && holdSecs < 120;

  return (
    <div
      className="booking-rail"
      style={{ borderLeft: "2px solid #cdd6da", background: "#e6eaea" }}
    >
      {/* Inner flex column — min-height: 100vh so total shelf is always at the bottom of the longest page */}
      <div
        style={{
          height: "100%",
          minHeight: "100vh",
          display: "flex",
          flexDirection: "column",
        }}
      >
        {/* 1. Month calendar — sticky at top */}
        <RailCalendar
          month={month}
          byDate={byDate}
          selectedDay={selectedDay}
          cartDates={cartDates}
          headerH={headerH}
          onDaySelect={onDaySelect}
          onPrevMonth={onPrevMonth}
          onNextMonth={onNextMonth}
        />

        {/* 2. Cart body — flex:1, scrolls with the page */}
        <div style={{ flex: 1, padding: "18px 22px 24px" }}>
          {/* YOUR SEATS header + hold countdown */}
          <div className="flex items-baseline justify-between gap-2 mb-3" style={{ flexWrap: "wrap" }}>
            <span
              className="font-plex-mono text-[12px] font-semibold tracking-[.16em]"
              style={{ color: "#16354a" }}
            >
              YOUR SEATS{totalSeats > 0 ? ` · ${totalSeats}` : ""}
            </span>
            {holdSecs !== null && (
              <span
                className="font-plex-mono text-[12px] font-semibold tracking-[.08em]"
                style={{ color: isWarning || isExpired ? "#8c3b12" : "#41565f" }}
              >
                {isExpired
                  ? "HOLD EXPIRED — SEATS RELEASED"
                  : `SEATS HELD ${fmtHoldTime(holdSecs)}`}
              </span>
            )}
          </div>

          {/* Empty state */}
          {cartItems.length === 0 ? (
            <div
              style={{
                border: "1px dashed #a9b6bc",
                background: "#eef1f0",
                padding: "18px 16px",
              }}
            >
              <div className="font-archivo text-[16px] font-bold">No seats yet.</div>
              <div
                className="font-archivo text-[14px] mt-1"
                style={{ lineHeight: 1.5, color: "#41565f" }}
              >
                Hit <strong>+</strong> on a ticket type. Nothing is charged until you pay.
              </div>
            </div>
          ) : (
            <ul
              style={{
                listStyle: "none",
                margin: 0,
                padding: 0,
                display: "flex",
                flexDirection: "column",
                gap: 8,
              }}
            >
              {cartItems.map((item) => {
                const subtotal = item.tickets.reduce(
                  (s, t) => s + t.quantity * t.priceCents,
                  0
                );
                const dateShort = new Date(
                  item.departureDate + "T12:00:00Z"
                ).toLocaleDateString("en-US", {
                  month: "short",
                  day: "numeric",
                  timeZone: "UTC",
                });
                return (
                  <li
                    key={`cart-${item.tripId}`}
                    style={{
                      background: "#ffffff",
                      border: "1px solid #cdd6da",
                      padding: "16px",
                    }}
                  >
                    <div className="flex items-baseline justify-between gap-2">
                      <div className="font-archivo text-[16px] font-bold">{item.productName}</div>
                      <div className="font-plex-mono text-[17px] font-semibold flex-shrink-0">
                        {dollars(subtotal)}
                      </div>
                    </div>
                    <div
                      className="font-plex-mono text-[12px] mt-[3px]"
                      style={{ color: "#41565f" }}
                    >
                      {dateShort} · {fmtTimeET(item.startTime)}
                    </div>
                    {item.tickets.map((t) => {
                      const lbl = t.displayLabel ?? t.ticketType;
                      return (
                        <div
                          key={t.ticketType}
                          className="font-plex-mono text-[12px] mt-[2px]"
                          style={{ color: "#41565f" }}
                        >
                          {t.quantity} × {lbl.charAt(0).toUpperCase() + lbl.slice(1)} ·{" "}
                          {dollars(t.priceCents)}
                        </div>
                      );
                    })}
                    <button
                      type="button"
                      onClick={() => onRemove(item.tripId)}
                      aria-label={`Remove ${item.productName} from cart`}
                      className="font-plex-mono text-[11px] font-semibold tracking-[.06em] cursor-pointer bg-transparent border-none mt-2 underline"
                      style={{
                        color: "#8c3b12",
                        padding: 0,
                        minHeight: 44,
                        display: "flex",
                        alignItems: "center",
                      }}
                    >
                      REMOVE
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {/* 3. Total shelf — sticky at bottom */}
        <div
          style={{
            position: "sticky",
            bottom: 0,
            zIndex: 3,
            borderTop: "2px solid #cdd6da",
            boxShadow: "0 -8px 16px rgba(13,28,38,.09)",
            background: "#e6eaea",
            padding: "14px 22px 18px",
          }}
        >
          <div className="flex items-baseline justify-between gap-2 mb-3">
            <span
              className="font-plex-mono text-[12px] font-semibold tracking-[.16em]"
              style={{ color: "#41565f" }}
            >
              TOTAL
            </span>
            <span
              className="font-plex-mono text-[30px] font-bold"
              style={{ lineHeight: 1, color: "#16354a" }}
            >
              {dollars(totalCents)}
            </span>
          </div>
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
            <span>{dollars(totalCents)} →</span>
          </button>
          <div
            className="font-plex-mono text-[11px] tracking-[.1em] mt-3 text-center"
            style={{ color: "#5b6f79" }}
          >
            FREE CANCELLATION · WEATHER REFUNDS · NO ACCOUNT NEEDED
          </div>
        </div>
      </div>
    </div>
  );
}
