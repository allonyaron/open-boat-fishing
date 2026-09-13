import { db } from "@/lib/db";
import { bookings, bookingItems, trips, products, vessels, tickets } from "@openboat/db";
import { fmtTimeET } from "@/lib/format";
import { and, eq, count } from "drizzle-orm";
import { getOperatorRecord } from "@/lib/operator";
import { notFound } from "next/navigation";
import { BookingNav } from "@/components/BookingCalendar";
import { ClearPendingPayment } from "@/components/ClearPendingPayment";
import { dollars } from "@openboat/utils";

function fmtDateShort(d: string) {
  return new Date(d + "T12:00:00Z").toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

export default async function ConfirmationPage({
  searchParams,
}: {
  searchParams: { code?: string; redirect_status?: string };
}) {
  const { code, redirect_status } = searchParams;

  if (!code) notFound();

  const operator = await getOperatorRecord();
  if (!operator) notFound();
  const op = operator;

  const [booking] = await db
    .select()
    .from(bookings)
    .where(and(eq(bookings.confirmationCode, code), eq(bookings.operatorId, op.id)));

  if (!booking) notFound();

  const items = await db
    .select({
      tripId: trips.id,
      tripDate: trips.departureDate,
      startTime: trips.startTime,
      endTime: trips.endTime,
      productName: products.displayName,
      category: products.category,
      whatToBring: products.whatToBring,
      vesselName: vessels.name,
      subtotal: bookingItems.subtotalCents,
    })
    .from(bookingItems)
    .innerJoin(trips, eq(trips.id, bookingItems.tripId))
    .innerJoin(products, eq(products.id, trips.productId))
    .innerJoin(vessels, eq(vessels.id, trips.vesselId))
    .where(eq(bookingItems.bookingId, booking.id));

  const ticketCounts = await db
    .select({ tripId: bookingItems.tripId, qty: count() })
    .from(tickets)
    .innerJoin(bookingItems, eq(bookingItems.id, tickets.bookingItemId))
    .where(eq(tickets.bookingId, booking.id))
    .groupBy(bookingItems.tripId);

  const qtyByTripId = Object.fromEntries(ticketCounts.map((r) => [r.tripId, r.qty]));

  const paymentSucceeded = redirect_status === "succeeded" || booking.status === "confirmed";

  // Earliest departure minus arrive_minutes_before = berth time
  const earliestStart = items.reduce(
    (min, item) => Math.min(min, new Date(item.startTime).getTime()),
    Infinity,
  );
  const berthTime =
    isFinite(earliestStart) && op.arriveMinutesBefore != null
      ? fmtTimeET(new Date(earliestStart - op.arriveMinutesBefore * 60 * 1000).toISOString())
      : null;

  const whatToBringSet = new Set<string>();
  for (const item of items) {
    for (const thing of item.whatToBring ?? []) whatToBringSet.add(thing);
  }
  const whatToBring = Array.from(whatToBringSet);
  const defaultWhatToBring =
    "Rods and bait are aboard — nothing to rent or buy. Bring a jacket and non-slip shoes. Bring cash for the pool. We have coffee at the dock.";

  const icsUrl = `/api/bookings/confirmation/${code}/calendar`;

  const operatorName = op.name ?? "Fishing Charter";

  if (!paymentSucceeded) {
    return (
      <div className="min-h-screen bg-deck font-archivo">
        <BookingNav
          operatorName={operatorName}
          dockAddress={op.dockAddress ?? null}
          phone={op.phone ?? null}
          step={3}
        />
        <div className="max-w-[760px] mx-auto px-6 md:px-[34px] py-16 text-center">
          <div
            className="font-plex-mono text-[11px] font-semibold tracking-[.18em] uppercase mb-4"
            style={{ color: "#8fa3ad" }}
          >
            Payment processing
          </div>
          <h1
            className="font-archivo font-bold uppercase mb-4"
            style={{ fontSize: "clamp(28px, 4.4vw, 44px)", letterSpacing: "-.02em", color: "#0d1c26" }}
          >
            Almost there.
          </h1>
          <p className="font-archivo text-[17px] mb-8" style={{ color: "#41565f", maxWidth: "44ch", margin: "0 auto 2rem" }}>
            Your payment is being confirmed. Reload in a moment to see your booking.
          </p>
          <a
            href={`/booking/confirmation?code=${code}`}
            className="inline-block font-archivo font-bold text-[15px] px-8 py-4 bg-orange text-white hover:bg-orange-ink transition-colors"
          >
            Reload
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-deck font-archivo">
      <ClearPendingPayment />
      <BookingNav
        operatorName={operatorName}
        dockAddress={op.dockAddress ?? null}
        phone={op.phone ?? null}
        step={3}
      />

      <div className="max-w-[760px] mx-auto px-6 md:px-[34px] pb-20">

        {/* Hull banner */}
        <div className="bg-hull px-7 py-8">
          <div
            className="font-plex-mono text-[13px] font-semibold tracking-[.2em] uppercase mb-3"
            style={{ color: "#ff8a5c" }}
          >
            YOU&apos;RE ON THE BOAT
          </div>
          <h1
            className="font-archivo font-bold uppercase leading-none mb-4"
            style={{ fontSize: "clamp(28px, 4.4vw, 44px)", letterSpacing: "-.02em", color: "#fff" }}
          >
            Seats confirmed.
          </h1>
          <p className="font-archivo text-[17px] leading-relaxed mb-6" style={{ color: "#b6c6ce" }}>
            Receipt is on its way to your email. This screen alone is enough to board — show it at
            the gangway.
          </p>

          <div
            className="flex flex-wrap gap-[26px] pt-5"
            style={{ borderTop: "1px solid #3c5867" }}
          >
            <div>
              <div
                className="font-plex-mono text-[11px] font-semibold tracking-[.18em] uppercase mb-1"
                style={{ color: "#8fa3ad" }}
              >
                Confirmation
              </div>
              <div
                className="font-plex-mono font-semibold tracking-[.08em]"
                style={{ fontSize: "34px", color: "#fff" }}
              >
                {booking.confirmationCode}
              </div>
            </div>
            {berthTime && (
              <div>
                <div
                  className="font-plex-mono text-[11px] font-semibold tracking-[.18em] uppercase mb-1"
                  style={{ color: "#8fa3ad" }}
                >
                  Be at dock by
                </div>
                <div
                  className="font-plex-mono font-semibold tracking-[.08em]"
                  style={{ fontSize: "34px", color: "#fff" }}
                >
                  {berthTime}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Trip card — border-top: none so it reads as one object with the banner */}
        <div
          className="bg-white"
          style={{ border: "1px solid #cdd6da", borderTop: "none" }}
        >
          {items.map((item, i) => (
            <div
              key={i}
              className="px-5 py-[18px]"
              style={i > 0 ? { borderTop: "1px solid #e3e9eb" } : undefined}
            >
              <div className="font-archivo text-[19px] font-bold text-hull leading-snug mb-1">
                {item.productName}
              </div>
              <div className="font-plex-mono text-[13px]" style={{ color: "#41565f" }}>
                {fmtDateShort(item.tripDate)} · {fmtTimeET(item.startTime)} –{" "}
                {fmtTimeET(item.endTime)} · {item.vesselName}
              </div>
              <div className="font-plex-mono text-[13px]" style={{ color: "#41565f" }}>
                {qtyByTripId[item.tripId] ?? 0} seat
                {(qtyByTripId[item.tripId] ?? 0) !== 1 ? "s" : ""} ·{" "}
                {dollars(item.subtotal)}
              </div>
            </div>
          ))}

          {/* Action row */}
          <div
            className="flex flex-wrap gap-3 px-5 py-4"
            style={{ borderTop: "1px solid #e3e9eb" }}
          >
            <a
              href={icsUrl}
              className="font-plex-mono text-[12px] font-semibold tracking-[.1em] uppercase px-5 py-[15px] transition-colors hover:bg-deck-3"
              style={{ border: "1px solid #0d1c26", color: "#0d1c26" }}
            >
              Add to Calendar
            </a>
            {op.dockMapsUrl && (
              <a
                href={op.dockMapsUrl}
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
        <div className="bg-orange px-6 py-[26px]">
          <div
            className="font-plex-mono text-[11px] font-semibold tracking-[.2em] uppercase mb-3"
            style={{ color: "rgba(255,255,255,.7)" }}
          >
            Before you go
          </div>
          <p
            className="font-archivo text-[19px] font-bold text-white leading-[1.4]"
            style={{ maxWidth: "52ch" }}
          >
            {whatToBring.length > 0 ? whatToBring.join(" · ") : defaultWhatToBring}
          </p>
        </div>

        {/* Closing line */}
        <div
          className="font-plex-mono text-[12px] leading-[1.8] mt-5"
          style={{ color: "#5b6f79" }}
        >
          Cancel free up to 24 hours before sailing.
          {op.phone && (
            <>
              {" "}
              Questions?{" "}
              <a href={`tel:${op.phone}`} className="underline" style={{ color: "#b1440f" }}>
                {op.phone}
              </a>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
