import { db } from "@/lib/db";
import { bookings, bookingItems, trips, products, vessels } from "@openboat/db";
import { fmtTimeET } from "@/lib/format";
import { and, eq } from "drizzle-orm";
import { getOperatorRecord } from "@/lib/operator";
import { notFound } from "next/navigation";

export default async function ConfirmationPage({
  searchParams,
}: {
  searchParams: { code?: string; redirect_status?: string };
}) {
  const { code, redirect_status } = searchParams;

  if (!code) notFound();

  const operator = await getOperatorRecord();
  if (!operator) notFound();
  // notFound() throws, so operator is non-null from here on
  const op = operator!;

  const operatorName = op.name ?? "Fishing Charter";

  const [booking] = await db
    .select()
    .from(bookings)
    .where(and(eq(bookings.confirmationCode, code), eq(bookings.operatorId, op.id)));

  if (!booking) notFound();

  const items = await db
    .select({
      tripDate: trips.departureDate,
      startTime: trips.startTime,
      endTime: trips.endTime,
      productName: products.displayName,
      category: products.category,
      whatToBring: products.whatToBring,
      vesselName: vessels.name,
      vesselColor: vessels.color,
      subtotal: bookingItems.subtotalCents,
    })
    .from(bookingItems)
    .innerJoin(trips, eq(trips.id, bookingItems.tripId))
    .innerJoin(products, eq(products.id, trips.productId))
    .innerJoin(vessels, eq(vessels.id, trips.vesselId))
    .where(eq(bookingItems.bookingId, booking.id));

  const paymentSucceeded = redirect_status === "succeeded";

  // Collect all "what to bring" items across products (de-duped)
  const whatToBringSet = new Set<string>();
  for (const item of items) {
    for (const thing of item.whatToBring ?? []) {
      whatToBringSet.add(thing);
    }
  }
  const whatToBring = Array.from(whatToBringSet);

  function fmtDate(d: string) {
    return new Date(d + "T12:00:00Z").toLocaleDateString("en-US", {
      weekday: "long",
      month: "long",
      day: "numeric",
      year: "numeric",
    });
  }

  function googleCalUrl(item: (typeof items)[0]) {
    const fmt = (d: Date | string) =>
      new Date(d).toISOString().replace(/[-:]/g, "").split(".")[0] + "Z";
    const params = new URLSearchParams({
      action: "TEMPLATE",
      text: item.productName,
      dates: `${fmt(item.startTime)}/${fmt(item.endTime)}`,
      details: `Booking confirmation: ${code}`,
      location: op.dockAddress ?? operatorName,
    });
    return `https://calendar.google.com/calendar/render?${params}`;
  }

  const icsUrl = `/api/bookings/confirmation/${code}/calendar`;

  const arriveNote =
    op.arriveMinutesBefore != null
      ? op.arriveMinutesBefore >= 60
        ? `Please arrive ${op.arriveMinutesBefore / 60} hour${op.arriveMinutesBefore === 60 ? "" : "s"} before departure`
        : `Please arrive ${op.arriveMinutesBefore} minutes before departure`
      : null;

  return (
    <div className="min-h-screen bg-surface font-jakarta">
      {/* App bar */}
      <header className="bg-white border-b border-hairline h-masthead flex items-center px-5 md:px-8 gap-3">
        <a href="/" className="flex items-center gap-3">
          <div className="w-logo h-logo rounded-icon bg-navy flex items-center justify-center">
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="white"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M2 20a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2" />
              <path d="M4 20l2-8h12l2 8" />
              <path d="M12 4v8" />
              <path d="M8 8h8" />
            </svg>
          </div>
          <span className="font-grotesk text-17 font-semibold text-ink">{operatorName}</span>
        </a>
      </header>

      <div className="max-w-lg mx-auto px-5 py-10">
        {/* Status banner */}
        <div
          className={`rounded-card p-6 mb-6 text-center ${
            paymentSucceeded ? "bg-success-bg" : "bg-gold-tint border border-gold/30"
          }`}
        >
          <div className="text-4xl mb-3">{paymentSucceeded ? "🎣" : "⏳"}</div>
          <h1 className="font-grotesk text-24 font-semibold text-ink mb-1">
            {paymentSucceeded ? "You're booked!" : "Payment processing…"}
          </h1>
          <p className="text-muted text-sm">
            {paymentSucceeded
              ? "Your tickets have been confirmed. See you on the water!"
              : "Your booking is being confirmed. Check back in a moment."}
          </p>
        </div>

        {/* Confirmation code */}
        <div className="bg-white rounded-card border border-card-border p-5 mb-4">
          <div className="text-xs font-bold uppercase tracking-widest text-faint mb-2">
            Confirmation Code
          </div>
          <div className="font-grotesk text-32 font-bold text-gold tracking-widest">
            {booking.confirmationCode}
          </div>
          <p className="text-xs text-faint mt-1">
            Show this at the gangway if you need assistance.
          </p>
        </div>

        {/* Booking details */}
        <div className="bg-white rounded-card border border-card-border p-5 mb-4">
          <div className="text-xs font-bold uppercase tracking-widest text-faint mb-3">
            Your Trips
          </div>
          <div className="space-y-4">
            {items.map((item, i) => (
              <div key={i} className="flex gap-3">
                <div
                  className="w-1 rounded-full flex-shrink-0"
                  style={{ backgroundColor: item.vesselColor }}
                />
                <div>
                  <div className="text-xs font-bold uppercase tracking-wide text-gold mb-0.5">
                    {item.category}
                  </div>
                  <div className="font-grotesk text-15 font-semibold text-ink">
                    {item.productName}
                  </div>
                  <div className="text-13 text-muted mt-0.5">{fmtDate(item.tripDate)}</div>
                  <div className="text-13 text-muted">
                    {fmtTimeET(item.startTime)} – {fmtTimeET(item.endTime)} · {item.vesselName}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Add to Calendar */}
        <div className="bg-white rounded-card border border-card-border p-5 mb-4">
          <div className="text-xs font-bold uppercase tracking-widest text-faint mb-3">
            Add to Calendar
          </div>
          <div className="flex flex-wrap gap-2">
            {items.map((item, i) => (
              <a
                key={`gcal-${i}`}
                href={googleCalUrl(item)}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-card-border text-13 font-medium text-ink hover:bg-surface transition-colors"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
                  <line x1="16" y1="2" x2="16" y2="6" />
                  <line x1="8" y1="2" x2="8" y2="6" />
                  <line x1="3" y1="10" x2="21" y2="10" />
                </svg>
                Google{items.length > 1 ? ` (${item.productName})` : ""}
              </a>
            ))}
            <a
              href={icsUrl}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-card-border text-13 font-medium text-ink hover:bg-surface transition-colors"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
                <line x1="16" y1="2" x2="16" y2="6" />
                <line x1="8" y1="2" x2="8" y2="6" />
                <line x1="3" y1="10" x2="21" y2="10" />
              </svg>
              Apple / Outlook (.ics)
            </a>
          </div>
        </div>

        {/* Get Directions + Arrive Early */}
        {(op.dockAddress || op.dockMapsUrl || arriveNote) && (
          <div className="bg-white rounded-card border border-card-border p-5 mb-4">
            <div className="text-xs font-bold uppercase tracking-widest text-faint mb-3">
              Getting There
            </div>
            {op.dockAddress && (
              <p className="text-14 text-ink mb-2">{op.dockAddress}</p>
            )}
            {arriveNote && (
              <p className="text-13 text-gold font-semibold mb-3">{arriveNote}</p>
            )}
            {op.dockMapsUrl && (
              <a
                href={op.dockMapsUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-card-border text-13 font-medium text-ink hover:bg-surface transition-colors"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
                  <circle cx="12" cy="10" r="3" />
                </svg>
                Get Directions
              </a>
            )}
          </div>
        )}

        {/* What to Bring */}
        {whatToBring.length > 0 && (
          <div className="bg-white rounded-card border border-card-border p-5 mb-4">
            <div className="text-xs font-bold uppercase tracking-widest text-faint mb-3">
              What to Bring
            </div>
            <ul className="space-y-1.5">
              {whatToBring.map((item, i) => (
                <li key={i} className="flex items-center gap-2 text-14 text-ink">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="text-gold flex-shrink-0">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                  {item}
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Customer + total */}
        <div className="bg-white rounded-card border border-card-border p-5 mb-6">
          <div className="text-xs font-bold uppercase tracking-widest text-faint mb-3">Details</div>
          <div className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-muted">Name</span>
              <span className="font-medium text-ink">{booking.customerName}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted">Email</span>
              <span className="font-medium text-ink">{booking.customerEmail}</span>
            </div>
            {booking.notes && (
              <div className="border-t border-hairline pt-2 mt-2">
                <span className="text-muted block mb-0.5">Notes</span>
                <span className="text-ink text-13">{booking.notes}</span>
              </div>
            )}
            <div className="flex justify-between border-t border-hairline pt-2 mt-2">
              <span className="text-muted">Total paid</span>
              <span className="font-grotesk text-18 font-bold text-ink">
                ${(booking.totalCents / 100).toFixed(2)}
              </span>
            </div>
          </div>
        </div>

        {/* Actions */}
        <div className="space-y-3">
          <a
            href={`/boarding/${booking.id}`}
            className="w-full bg-gold text-navy font-grotesk font-semibold py-4 rounded-btn flex items-center justify-center gap-2 hover:bg-gold-hover transition-colors"
          >
            View Boarding Passes
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M5 12h14" />
              <path d="m12 5 7 7-7 7" />
            </svg>
          </a>
          <a
            href="/"
            className="w-full bg-white border border-card-border text-ink font-semibold py-4 rounded-btn flex items-center justify-center hover:bg-surface transition-colors text-sm"
          >
            Back to calendar
          </a>
        </div>

        <p className="text-xs text-faint text-center mt-6">
          A confirmation email will be sent to {booking.customerEmail}. This page is sufficient for
          boarding if you don't receive it.
        </p>
      </div>
    </div>
  );
}
