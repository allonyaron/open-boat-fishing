import { env } from "@/lib/env";
import { BookingNav } from "@/components/BookingCalendar";
import { ClearPendingPayment } from "@/components/ClearPendingPayment";
import type { ConfirmedBooking } from "@/lib/bookings/get-confirmed-booking";

const DEFAULT_WHAT_TO_BRING =
  "Rods and bait are aboard — nothing to rent or buy. Bring a jacket and non-slip shoes. Bring cash for the pool. We have coffee at the dock.";

export function ConfirmedBookingView({
  operatorName,
  dockAddress,
  phone,
  dockMapsUrl,
  booking,
}: {
  operatorName: string;
  dockAddress: string | null;
  phone: string | null;
  dockMapsUrl: string | null;
  booking: ConfirmedBooking;
}) {
  const icsUrl = `/api/bookings/confirmation/${booking.confirmationCode}/calendar`;
  const boardingUrl = `${env.NEXT_PUBLIC_APP_URL ?? ""}/boarding/${booking.bookingId}`;
  const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=156x156&margin=0&data=${encodeURIComponent(boardingUrl)}`;

  return (
    <div className="min-h-screen bg-deck font-archivo">
      <ClearPendingPayment />
      <BookingNav
        operatorName={operatorName}
        dockAddress={dockAddress}
        phone={phone}
        step={3}
        rightLabelOverride="CONFIRMED"
        rightLabelColor="#ff8a5c"
      />

      <div className="max-w-[760px] mx-auto px-4 lg:px-[34px] pt-0 pb-[60px]">
        {/* Hull banner */}
        <div className="bg-hull" style={{ padding: "24px 16px 26px" }}>
          <div
            className="font-plex-mono font-semibold tracking-[.18em] uppercase"
            style={{ fontSize: 12, color: "#ff8a5c" }}
          >
            YOU&apos;RE ON THE BOAT
          </div>
          <h1
            className="font-archivo font-bold uppercase leading-none mt-3"
            style={{ fontSize: 34, letterSpacing: "-.02em", color: "#fff" }}
          >
            SEATS CONFIRMED.
          </h1>
          <p className="font-archivo mt-3" style={{ fontSize: 16, lineHeight: 1.55, color: "#b6c6ce" }}>
            Receipt is on its way to your email. This screen alone is enough to board — show the
            code at the gangway.
          </p>

          {/* QR + confirmation code row — stacks below 360px */}
          <div
            className="flex flex-wrap items-start"
            style={{ gap: 18, marginTop: 22, paddingTop: 20, borderTop: "1px solid #3c5867" }}
          >
            <div className="bg-white flex-none" style={{ padding: 8 }}>
              <img
                src={qrUrl}
                alt="Boarding pass QR code"
                className="w-[132px] h-[132px] lg:w-[156px] lg:h-[156px]"
              />
            </div>
            <div>
              <div
                className="font-plex-mono font-semibold tracking-[.16em] uppercase"
                style={{ fontSize: 11, color: "#c9d6dd" }}
              >
                CONFIRMATION
              </div>
              <div
                className="font-plex-mono font-semibold mt-[6px]"
                style={{ fontSize: 27, letterSpacing: ".06em", color: "#fff" }}
              >
                {booking.confirmationCode}
              </div>
              {booking.berthTime && (
                <>
                  <div
                    className="font-plex-mono font-semibold tracking-[.16em] uppercase"
                    style={{ fontSize: 11, color: "#c9d6dd", marginTop: 18 }}
                  >
                    BE AT DOCK BY
                  </div>
                  <div
                    className="font-plex-mono font-semibold mt-[6px]"
                    style={{ fontSize: 27, letterSpacing: ".06em", color: "#fff" }}
                  >
                    {booking.berthTime}
                  </div>
                </>
              )}
            </div>
          </div>
        </div>

        {/* Trip card — border-top: none so it reads as one object with the banner */}
        <div className="bg-white" style={{ border: "1px solid #cdd6da", borderTop: "none" }}>
          {booking.items.map((item, i) => (
            <div
              key={item.tripId}
              className="px-5 py-[20px]"
              style={i > 0 ? { borderTop: "1px solid #e3e9eb" } : undefined}
            >
              <div className="font-archivo font-bold text-hull leading-snug" style={{ fontSize: 19 }}>
                {item.productName}
              </div>
              <div className="font-plex-mono mt-[5px]" style={{ fontSize: 13, color: "#41565f" }}>
                {item.meta}
              </div>
              {item.ticketLines.map((line) => (
                <div key={line} className="font-plex-mono mt-[2px]" style={{ fontSize: 13, color: "#41565f" }}>
                  {line}
                </div>
              ))}
              <div className="font-plex-mono font-semibold mt-1" style={{ fontSize: 13 }}>{item.subtotalLabel}</div>
            </div>
          ))}

          {/* Actions — stacked full-width on mobile, inline on desktop */}
          <div
            className="flex flex-col lg:flex-row lg:flex-wrap px-4 lg:px-5 py-4"
            style={{ borderTop: "1px solid #e3e9eb", gap: 8 }}
          >
            <a
              href={icsUrl}
              className="font-plex-mono font-semibold tracking-[.1em] uppercase text-center transition-colors hover:bg-[#e6ebeb]"
              style={{ border: "1px solid #16354a", color: "#16354a", padding: "17px 20px", textDecoration: "none", fontSize: 12 }}
            >
              Add to calendar
            </a>
            {dockMapsUrl && (
              <a
                href={dockMapsUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="font-plex-mono font-semibold tracking-[.1em] uppercase text-center transition-colors hover:bg-[#e6ebeb]"
                style={{ border: "1px solid #16354a", color: "#16354a", padding: "17px 20px", textDecoration: "none", fontSize: 12 }}
              >
                Directions to dock
              </a>
            )}
            <span
              className="font-plex-mono font-semibold tracking-[.1em] uppercase text-center transition-colors hover:bg-[#e6ebeb] cursor-pointer"
              style={{ border: "1px solid #16354a", color: "#16354a", padding: "17px 20px", fontSize: 12 }}
            >
              Text me the pass
            </span>
          </div>
        </div>

        {/* Before you go — orange band */}
        <div className="mt-5" style={{ background: "#c94510", padding: "22px 16px" }}>
          <div
            className="font-plex-mono font-semibold tracking-[.18em] uppercase"
            style={{ fontSize: 12, color: "rgba(255,255,255,.75)" }}
          >
            Before you go
          </div>
          <p className="font-archivo font-bold text-white mt-[10px]" style={{ fontSize: 18, lineHeight: 1.4, maxWidth: "52ch" }}>
            {booking.whatToBring.length > 0 ? booking.whatToBring.join(" · ") : DEFAULT_WHAT_TO_BRING}
          </p>
        </div>
      </div>

      {/* Footer — hull ground */}
      <div
        className="hull bg-hull font-plex-mono"
        style={{ padding: "22px 24px", color: "#c9d6dd", fontSize: 12, letterSpacing: ".05em", lineHeight: 1.7 }}
      >
        <div className="max-w-[760px] mx-auto flex flex-wrap gap-[10px_26px] justify-between">
          <span>
            Cancel free until 24h before sailing.
            {phone && <> Call {phone}</>}
          </span>
          {dockAddress && <span>{dockAddress}</span>}
        </div>
      </div>
    </div>
  );
}
