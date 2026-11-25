import { getOperatorRecord } from "@/lib/operator";
import { notFound, redirect } from "next/navigation";
import { BookingNav } from "@/components/BookingCalendar";
import { BookingNotice } from "@/components/booking/BookingNotice";
import { ConfirmedBookingView } from "@/components/booking/ConfirmedBookingView";
import { ProcessingScreen } from "@/components/booking/ProcessingScreen";
import { resolveBookingPage, type BookingPageParams } from "@/lib/bookings/booking-page";

// Opens only with the booking key or the checkout's PaymentIntent credentials
// (`resolveBookingPage`). A confirmation code alone shows nothing (P8-1).
export default async function ConfirmationPage({ searchParams }: { searchParams: BookingPageParams }) {
  const operator = await getOperatorRecord();
  if (!operator) notFound();

  const state = await resolveBookingPage(searchParams, operator.id, operator.arriveMinutesBefore ?? null);
  if (state.kind === "redirect") redirect(state.to);

  const shell = {
    operatorName: operator.name ?? "Fishing Charter",
    dockAddress: operator.dockAddress ?? null,
    phone: operator.phone ?? null,
  };

  switch (state.kind) {
    case "confirmed":
      return <ConfirmedBookingView {...shell} dockMapsUrl={operator.dockMapsUrl ?? null} booking={state.booking} />;
    case "processing":
      return (
        <div className="min-h-screen bg-deck font-archivo">
          <BookingNav {...shell} step={3} />
          <ProcessingScreen paid={state.paid} />
        </div>
      );
    case "unpaid":
      return (
        <BookingNotice
          {...shell}
          eyebrow="PAYMENT NOT RECEIVED"
          heading="THE PAYMENT DIDN'T GO THROUGH."
          action={{ href: "/checkout", label: "BACK TO CHECKOUT" }}
        >
          You haven&apos;t been charged for this booking.
        </BookingNotice>
      );
    case "cancelled":
      return (
        <BookingNotice {...shell} eyebrow="BOOKING CANCELLED" heading="THIS BOOKING IS CANCELLED.">
          Its boarding passes no longer work. If it was paid, the refund goes back to the card you used.
        </BookingNotice>
      );
    case "expired":
      return (
        <BookingNotice {...shell} eyebrow="LINK EXPIRED" heading="THIS TRIP IS OVER.">
          This booking&apos;s links stop working two weeks after its last trip.
        </BookingNotice>
      );
    case "locked":
      return (
        <BookingNotice {...shell} eyebrow="YOUR BOOKING" heading="OPEN IT FROM YOUR EMAIL.">
          Your booking and boarding passes open from the link in your confirmation email.
        </BookingNotice>
      );
  }
}
