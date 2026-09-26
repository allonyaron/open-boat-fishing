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

  const adultFare =
    trip.product.prices.find((p) => p.ticketType.toLowerCase() === "adult") ??
    trip.product.prices[0];

  const seatLabel = soldOut
    ? "SOLD OUT"
    : trip.seatsRemaining <= 10
    ? `${trip.seatsRemaining} SEATS LEFT`
    : "SEATS OPEN";
  const seatColor = soldOut ? "#41565f" : trip.seatsRemaining <= 10 ? "#8c3b12" : "#186a4a";

  return (
    <div
      className="booking-trip-row"
      style={{
        marginTop: 12,
        padding: "18px 20px",
        border: `1px solid ${inCart ? "#c94510" : "#dde4e6"}`,
        background: inCart ? "#ffffff" : "#f6f8f8",
        opacity: soldOut ? 0.55 : 1,
      }}
    >
      {/* Col 1: species kicker + name + meta */}
      <div className="trip-col-main min-w-0">
        <div
          className="font-plex-mono text-[11px] tracking-[.16em]"
          style={{ color: "#b1440f" }}
        >
          {trip.product.category.toUpperCase()}
        </div>
        <div className="font-archivo text-[19px] font-bold tracking-[-0.01em] mt-1">
          {trip.product.displayName}
        </div>
        <div className="font-plex-mono text-[13px] mt-[5px]" style={{ color: "#41565f" }}>
          {fmtTimeET(trip.startTime)} – {fmtTimeET(trip.endTime)} ·{" "}
          {fmtDuration(trip.startTime, trip.endTime)} · {trip.vessel.name}
        </div>
      </div>

      {/* Col 2: adult fare */}
      <div className="trip-col-fare font-plex-mono text-[20px] font-semibold self-center">
        {adultFare ? dollars(adultFare.priceCents) : "—"}
      </div>

      {/* Col 3: seat state */}
      <div
        className="trip-col-seats font-plex-mono text-[12px] font-semibold tracking-[.06em] self-center"
        style={{ color: seatColor }}
      >
        {seatLabel}
      </div>

      {/* Col 4: steppers or waitlist */}
      <div className="trip-col-action flex flex-col gap-[10px] justify-center">
        {soldOut ? (
          <button
            type="button"
            className="font-plex-mono text-[13px] font-semibold tracking-[.1em] cursor-pointer hover:bg-deck-3 transition-colors bg-transparent"
            style={{
              border: "1px solid #9aa8ae",
              padding: "11px 18px",
              color: "#41565f",
              minHeight: 44,
            }}
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
