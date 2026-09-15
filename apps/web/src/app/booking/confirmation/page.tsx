import { getOperatorRecord } from "@/lib/operator";
import { notFound } from "next/navigation";
import { BookingNav } from "@/components/BookingCalendar";
import { ConfirmedBookingView } from "@/components/booking/ConfirmedBookingView";
import { ProcessingScreen } from "@/components/booking/ProcessingScreen";
import { getConfirmedBooking } from "@/lib/bookings/get-confirmed-booking";

export default async function ConfirmationPage({
  searchParams,
}: {
  searchParams: { code?: string; redirect_status?: string };
}) {
  const { code, redirect_status } = searchParams;

  if (!code) notFound();

  if (redirect_status && redirect_status !== "succeeded") {
    console.error("[confirmation] non-succeeded redirect_status", { code, redirect_status });
  }

  const operator = await getOperatorRecord();
  if (!operator) notFound();

  const booking = await getConfirmedBooking(code, operator.id, operator.arriveMinutesBefore ?? null);
  if (!booking) notFound();

  const operatorName = operator.name ?? "Fishing Charter";
  const paymentSucceeded = redirect_status === "succeeded" || booking.status === "confirmed";

  if (!paymentSucceeded) {
    return (
      <div className="min-h-screen bg-deck font-archivo">
        <BookingNav
          operatorName={operatorName}
          dockAddress={operator.dockAddress ?? null}
          phone={operator.phone ?? null}
          step={3}
        />
        <ProcessingScreen />
      </div>
    );
  }

  return (
    <ConfirmedBookingView
      operatorName={operatorName}
      dockAddress={operator.dockAddress ?? null}
      phone={operator.phone ?? null}
      dockMapsUrl={operator.dockMapsUrl ?? null}
      booking={booking}
    />
  );
}
