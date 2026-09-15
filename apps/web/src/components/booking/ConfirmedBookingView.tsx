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
      <BookingNav operatorName={operatorName} dockAddress={dockAddress} phone={phone} step={3} />

      <div className="max-w-[760px] mx-auto px-6 md:px-[34px] pt-[34px] pb-[60px]">
        {/* Hull banner */}
        <div className="bg-hull px-7 py-8">
          <div
            className="font-plex-mono text-[12px] font-semibold tracking-[.18em] uppercase"
            style={{ color: "#ff8a5c" }}
          >
            YOU&apos;RE ON THE BOAT
          </div>
          <h1
            className="font-archivo font-bold uppercase leading-none mt-3"
            style={{ fontSize: "clamp(28px, 4.4vw, 44px)", letterSpacing: "-.02em", color: "#fff" }}
          >
            Seats confirmed.
          </h1>
          <p className="font-archivo text-[17px] leading-relaxed mt-3" style={{ color: "#b6c6ce" }}>
            Receipt is on its way to your email. This screen alone is enough to board — show the
            code at the gangway.
          </p>

          <div
            className="flex flex-wrap gap-[26px] items-start pt-[22px] mt-[26px]"
            style={{ borderTop: "1px solid #3c5867" }}
          >
            <div className="bg-white p-[10px] flex-none">
              <img src={qrUrl} alt="Boarding pass QR code" width={156} height={156} />
            </div>
            <div>
              <div
                className="font-plex-mono text-[11px] font-semibold tracking-[.16em] uppercase"
                style={{ color: "#8fa3ad" }}
              >
                Confirmation
              </div>
              <div
                className="font-plex-mono font-semibold tracking-[.08em] mt-[6px]"
                style={{ fontSize: "34px", color: "#fff" }}
              >
                {booking.confirmationCode}
              </div>
              {booking.berthTime && (
                <>
                  <div
                    className="font-plex-mono text-[11px] font-semibold tracking-[.16em] uppercase mt-5"
                    style={{ color: "#8fa3ad" }}
                  >
                    Be at dock by
                  </div>
                  <div
                    className="font-plex-mono font-semibold mt-[6px]"
                    style={{ fontSize: "34px", color: "#fff" }}
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
              <div className="font-archivo text-[19px] font-bold text-hull leading-snug">
                {item.productName}
              </div>
              <div className="font-plex-mono text-[13px] mt-[5px]" style={{ color: "#41565f" }}>
                {item.meta}
              </div>
              {item.ticketLines.map((line) => (
                <div key={line} className="font-plex-mono text-[13px] mt-[2px]" style={{ color: "#41565f" }}>
                  {line}
                </div>
              ))}
              <div className="font-plex-mono text-[13px] font-semibold mt-1">{item.subtotalLabel}</div>
            </div>
          ))}

          {/* Action row */}
          <div className="flex flex-wrap gap-3 px-5 py-4" style={{ borderTop: "1px solid #e3e9eb" }}>
            <a
              href={icsUrl}
              className="font-plex-mono text-[12px] font-semibold tracking-[.1em] uppercase px-5 py-[15px] transition-colors hover:bg-deck-3"
              style={{ border: "1px solid #0d1c26", color: "#0d1c26" }}
            >
              Add to Calendar
            </a>
            {dockMapsUrl && (
              <a
                href={dockMapsUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="font-plex-mono text-[12px] font-semibold tracking-[.1em] uppercase px-5 py-[15px] transition-colors hover:bg-deck-3"
                style={{ border: "1px solid #0d1c26", color: "#0d1c26" }}
              >
                Directions to Dock
              </a>
            )}
            <span
              className="font-plex-mono text-[12px] font-semibold tracking-[.1em] uppercase px-5 py-[15px] cursor-pointer hover:bg-deck-3"
              style={{ border: "1px solid #0d1c26", color: "#0d1c26" }}
            >
              Text Me the Pass
            </span>
          </div>
        </div>

        {/* Before you go — orange band */}
        <div className="bg-orange px-6 py-[26px] mt-[26px]">
          <div
            className="font-plex-mono text-[12px] font-semibold tracking-[.18em] uppercase"
            style={{ color: "rgba(255,255,255,.7)" }}
          >
            Before you go
          </div>
          <p className="font-archivo text-[19px] font-bold text-white leading-[1.4] mt-[10px]" style={{ maxWidth: "52ch" }}>
            {booking.whatToBring.length > 0 ? booking.whatToBring.join(" · ") : DEFAULT_WHAT_TO_BRING}
          </p>
        </div>
      </div>

      {/* Footer — hull ground */}
      <div
        className="hull bg-hull font-plex-mono text-[12px] tracking-[.05em]"
        style={{ padding: "22px 24px", color: "#8fa3ad", lineHeight: 1.7 }}
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
