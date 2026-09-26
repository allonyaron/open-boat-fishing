import { useState } from "react";
import { fmtTimeET } from "@/lib/format";
import { dollars } from "./format";
import type { EnrichedCartItem } from "./types";

export function MobileCartBar({
  totalCents,
  totalSeats,
  holdSecs,
  cartItems,
  onCheckout,
  onRemove,
}: {
  totalCents: number;
  totalSeats: number;
  holdSecs: number | null;
  cartItems: EnrichedCartItem[];
  onCheckout: () => void;
  onRemove: (tripId: string) => void;
}) {
  const [open, setOpen] = useState(false);

  const hasSeats = totalSeats > 0;
  const isExpired = holdSecs !== null && holdSecs <= 0;
  const isWarning = holdSecs !== null && holdSecs > 0 && holdSecs < 120;
  const holdLabel = hasSeats && holdSecs !== null
    ? isExpired ? "HOLD EXPIRED" : `${Math.floor(holdSecs / 60)}:${String(holdSecs % 60).padStart(2,"0")}`
    : "—";
  const chipUrgent = isExpired || isWarning;

  return (
    <div
      className="booking-mobile-bar hidden"
      style={{
        position: "sticky",
        bottom: 0,
        zIndex: 20,
        background: "#fff",
        boxShadow: "0 -10px 24px rgba(13,28,38,.18)",
        borderTop: "3px solid #c94510",
      }}
    >
      {/* Expanded sheet */}
      {open && (
        <div
          style={{
            maxHeight: 232,
            overflowY: "auto",
            background: "#f6f8f8",
          }}
        >
          {cartItems.length === 0 ? (
            <div className="font-archivo" style={{ padding: "14px 16px", fontSize: 13, color: "#41565f" }}>
              No seats picked yet — use the steppers above and your tickets land here.
            </div>
          ) : (
            cartItems.map((item) => {
              const subtotal = item.tickets.reduce((s, t) => s + t.priceCents * t.quantity, 0);
              const faresLabel = item.tickets.map((t) => `${t.quantity} ${t.displayLabel ?? t.ticketType} × ${dollars(t.priceCents)}`).join(" · ");
              const dt = new Date(item.departureDate + "T12:00:00Z");
              const dateLabel = dt.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" }).toUpperCase();
              return (
                <div
                  key={item.tripId}
                  className="flex items-start justify-between gap-2"
                  style={{ padding: "10px 16px", borderBottom: "1px solid #e3e9eb" }}
                >
                  <div style={{ minWidth: 0 }}>
                    <div className="font-archivo font-semibold" style={{ fontSize: 14, color: "#16354a" }}>{item.productName}</div>
                    <div className="font-plex-mono" style={{ fontSize: 11, color: "#5b6f79", marginTop: 2 }}>{dateLabel} · {fmtTimeET(item.startTime)}</div>
                    <div className="font-plex-mono" style={{ fontSize: 11, color: "#5b6f79" }}>{faresLabel}</div>
                  </div>
                  <div className="flex flex-col items-end flex-shrink-0">
                    <span className="font-plex-mono font-bold" style={{ fontSize: 15, color: "#16354a" }}>{dollars(subtotal)}</span>
                    <button
                      type="button"
                      onClick={() => onRemove(item.tripId)}
                      className="font-plex-mono"
                      style={{ fontSize: 11, color: "#5b6f79", background: "none", border: "none", cursor: "pointer", textDecoration: "underline", marginTop: 2 }}
                    >
                      REMOVE
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </div>
      )}

      {/* Seats bar (tap to expand) */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        style={{
          display: "flex",
          width: "100%",
          alignItems: "center",
          justifyContent: "space-between",
          minHeight: 60,
          background: "#16354a",
          border: "none",
          cursor: "pointer",
          padding: "0 16px",
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 4 }}>
          <span className="font-archivo font-bold text-white uppercase" style={{ fontSize: 14 }}>
            YOUR SEATS{totalSeats > 0 ? ` · ${totalSeats} ${totalSeats === 1 ? "TICKET" : "TICKETS"}` : ""}
          </span>
          {/* Hold chip */}
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              padding: "5px 9px",
              background: chipUrgent ? "#c94510" : "transparent",
              boxShadow: chipUrgent ? "none" : `inset 0 0 0 1px ${hasSeats ? "#c94510" : "#3c5867"}`,
              fontSize: 10,
              fontFamily: "var(--font-ibm-plex-mono)",
              letterSpacing: ".14em",
              color: chipUrgent ? "#fff" : hasSeats ? "#c9d6dd" : "#c9d6dd",
            }}
          >
            <span style={{ fontSize: 10, letterSpacing: ".14em", color: chipUrgent ? "#ffe3d6" : hasSeats ? "#c9d6dd" : "#c9d6dd" }}>
              {hasSeats ? "SEATS HELD" : "NO SEATS HELD"}
            </span>
            <span style={{ fontSize: 14, fontWeight: 700, letterSpacing: ".04em", color: chipUrgent ? "#fff" : "#ff8a5c" }}>
              {holdLabel}
            </span>
          </span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span className="font-plex-mono" style={{ fontSize: 11, letterSpacing: ".1em", color: "#c9d6dd" }}>
            {open ? "HIDE YOUR SEATS" : "SHOW YOUR SEATS"}
          </span>
          <div
            style={{
              width: 38,
              height: 38,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              boxShadow: "inset 0 0 0 1px #3c5867",
              color: "#c9d6dd",
              fontSize: 16,
            }}
          >
            {open ? "▴" : "▾"}
          </div>
        </div>
      </button>

      {/* Total + checkout */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "12px 16px",
        }}
      >
        <div>
          <div className="font-plex-mono" style={{ fontSize: 10, letterSpacing: ".16em", color: "#5b6f79" }}>TOTAL</div>
          <div className="font-archivo font-bold" style={{ fontSize: 26, color: hasSeats ? "#16354a" : "#9aa8ae" }}>
            {dollars(totalCents)}
          </div>
        </div>
        <button
          type="button"
          onClick={hasSeats && !isExpired ? onCheckout : undefined}
          disabled={!hasSeats || isExpired}
          className="font-archivo font-bold uppercase"
          style={{
            height: 58,
            minWidth: 170,
            background: hasSeats && !isExpired ? "#c94510" : "#b9c3c7",
            color: hasSeats && !isExpired ? "#fff" : "#41565f",
            border: "none",
            cursor: hasSeats && !isExpired ? "pointer" : "default",
            fontSize: 15,
            letterSpacing: ".08em",
          }}
        >
          CHECK OUT →
        </button>
      </div>
    </div>
  );
}
