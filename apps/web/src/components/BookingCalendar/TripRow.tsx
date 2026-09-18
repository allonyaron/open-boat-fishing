import { fmtTimeET } from "@/lib/format";
import { InlineStepper } from "./InlineStepper";
import { dollars, fmtDuration, getDisplayPrices } from "./format";
import type { Trip } from "./types";

export function TripRow({
  trip,
  getQty,
  onAdjustQty,
}: {
  trip: Trip;
  getQty: (tripId: string, ticketType: string) => number;
  onAdjustQty: (tripId: string, ticketType: string, delta: 1 | -1) => void;
}) {
  const soldOut = trip.seatsRemaining === 0;
  const displayPrices = getDisplayPrices(trip.product.prices);
  const totalQty = displayPrices.reduce((sum, p) => sum + getQty(trip.id, p.ticketType), 0);
  const inCart = totalQty > 0;

  const seatLabel =
    soldOut
      ? "SOLD OUT"
      : trip.seatsRemaining <= 10
      ? `${trip.seatsRemaining} SEATS LEFT`
      : `${trip.seatsRemaining} OPEN`;
  const seatColorClass = soldOut
    ? "text-[#9aa8ae]"
    : trip.seatsRemaining <= 10
    ? "text-[#9a3c12]"
    : "text-green-open";

  return (
    <div
      className={`booking-trip-row transition-colors ${
        inCart ? "bg-white" : "bg-deck-3"
      } ${soldOut ? "opacity-[.55]" : ""}`}
      style={{
        padding: "18px 20px",
        border: `1px solid ${inCart ? "#d1541f" : "#dde4e6"}`,
      }}
    >
      {/* Col 1: trip info */}
      <div className="trip-col-main min-w-0">
        <div className="font-plex-mono text-[12px] tracking-[.16em]" style={{ color: "#9a3c12" }}>
          {trip.product.category.toUpperCase()}
        </div>
        <div className="text-[19px] font-bold tracking-[-0.01em] mt-1 font-archivo">
          {trip.product.displayName}
        </div>
        <div className="font-plex-mono text-[13px] mt-[5px]" style={{ color: "#444141" }}>
          {fmtTimeET(trip.startTime)} – {fmtTimeET(trip.endTime)} · {fmtDuration(trip.startTime, trip.endTime)} · {trip.vessel.name}
        </div>
      </div>

      {/* Col 2: seat state */}
      <div className={`trip-col-seats font-plex-mono text-[13px] font-semibold tracking-[.06em] self-center ${seatColorClass}`}>
        {seatLabel}
      </div>

      {/* Col 3: stepper or waitlist */}
      <div className="trip-col-action flex flex-col gap-2 justify-center">
        {soldOut ? (
          <button
            type="button"
            className="font-plex-mono text-[13px] font-semibold tracking-[.1em] cursor-pointer hover:bg-deck-3 transition-colors bg-transparent"
            style={{ border: "1px solid #9aa8ae", padding: "11px 18px", color: "#444141", minHeight: 44 }}
          >
            WAITLIST
          </button>
        ) : (
          displayPrices.map((price) => {
            const qty = getQty(trip.id, price.ticketType);
            const otherQty = displayPrices
              .filter((p) => p.ticketType !== price.ticketType)
              .reduce((sum, p) => sum + getQty(trip.id, p.ticketType), 0);
            const atMax = qty >= trip.seatsRemaining - otherQty;
            const label = price.displayLabel ?? price.ticketType;
            return (
              <div key={price.ticketType} className="flex items-center justify-between gap-3">
                <div className="font-plex-mono text-[13px]" style={{ color: "#201e1d" }}>
                  {label.charAt(0).toUpperCase() + label.slice(1)} · {dollars(price.priceCents)}
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
