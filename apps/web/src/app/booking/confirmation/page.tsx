import { db } from "@/lib/db";
import { bookings, bookingItems, trips, products, vessels, operators } from "@openboat/db";
import { eq } from "drizzle-orm";
import { notFound } from "next/navigation";

export default async function ConfirmationPage({
  searchParams,
}: {
  searchParams: { code?: string; redirect_status?: string };
}) {
  const { code, redirect_status } = searchParams;

  if (!code) notFound();

  const [booking] = await db
    .select()
    .from(bookings)
    .where(eq(bookings.confirmationCode, code));

  if (!booking) notFound();

  const [operator] = await db.select({ name: operators.name }).from(operators).limit(1);
  const operatorName = operator?.name ?? "Fishing Charter";

  const items = await db
    .select({
      tripDate: trips.departureDate,
      startTime: trips.startTime,
      endTime: trips.endTime,
      productName: products.displayName,
      category: products.category,
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

  function fmtTime(iso: Date | string) {
    return new Date(iso).toLocaleTimeString("en-US", {
      hour: "numeric", minute: "2-digit", timeZone: "America/New_York",
    });
  }

  function fmtDate(d: string) {
    return new Date(d + "T12:00:00Z").toLocaleDateString("en-US", {
      weekday: "long", month: "long", day: "numeric", year: "numeric",
    });
  }

  return (
    <div className="min-h-screen bg-surface font-jakarta">
      {/* App bar */}
      <header className="bg-white border-b border-hairline h-[66px] flex items-center px-5 md:px-8 gap-3">
        <a href="/" className="flex items-center gap-3">
          <div className="w-[34px] h-[34px] rounded-[10px] bg-teal flex items-center justify-center">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M2 20a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2"/><path d="M4 20l2-8h12l2 8"/><path d="M12 4v8"/><path d="M8 8h8"/>
            </svg>
          </div>
          <span className="font-grotesk text-[17px] font-semibold text-ink">{operatorName}</span>
        </a>
      </header>

      <div className="max-w-lg mx-auto px-5 py-10">
        {/* Status banner */}
        <div className={`rounded-[20px] p-6 mb-6 text-center ${
          paymentSucceeded ? "bg-success-bg" : "bg-yellow-50 border border-yellow-200"
        }`}>
          <div className="text-4xl mb-3">{paymentSucceeded ? "🎣" : "⏳"}</div>
          <h1 className="font-grotesk text-[24px] font-semibold text-ink mb-1">
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
          <div className="font-grotesk text-[32px] font-bold text-teal tracking-widest">
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
                  <div className="text-xs font-bold uppercase tracking-wide text-teal mb-0.5">
                    {item.category}
                  </div>
                  <div className="font-grotesk text-[15px] font-semibold text-ink">
                    {item.productName}
                  </div>
                  <div className="text-[13px] text-muted mt-0.5">
                    {fmtDate(item.tripDate)}
                  </div>
                  <div className="text-[13px] text-muted">
                    {fmtTime(item.startTime)} – {fmtTime(item.endTime)} · {item.vesselName}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Customer + total */}
        <div className="bg-white rounded-card border border-card-border p-5 mb-6">
          <div className="text-xs font-bold uppercase tracking-widest text-faint mb-3">
            Details
          </div>
          <div className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-muted">Name</span>
              <span className="font-medium text-ink">{booking.customerName}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted">Email</span>
              <span className="font-medium text-ink">{booking.customerEmail}</span>
            </div>
            <div className="flex justify-between border-t border-hairline pt-2 mt-2">
              <span className="text-muted">Total paid</span>
              <span className="font-grotesk text-[18px] font-bold text-ink">
                ${(booking.totalCents / 100).toFixed(2)}
              </span>
            </div>
          </div>
        </div>

        {/* Actions */}
        <div className="space-y-3">
          <a
            href={`/boarding/${booking.id}`}
            className="w-full bg-teal text-white font-grotesk font-semibold py-4 rounded-btn flex items-center justify-center gap-2 hover:bg-teal-hover transition-colors"
          >
            View Boarding Passes
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M5 12h14"/><path d="m12 5 7 7-7 7"/>
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
          A confirmation email will be sent to {booking.customerEmail}.
          This page is sufficient for boarding if you don't receive it.
        </p>
      </div>
    </div>
  );
}
