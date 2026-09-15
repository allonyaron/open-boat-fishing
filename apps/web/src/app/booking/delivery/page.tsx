import { getOperatorRecord } from "@/lib/operator";
import { notFound, redirect } from "next/navigation";
import { ConfirmedBookingView } from "@/components/booking/ConfirmedBookingView";
import { getConfirmedBooking } from "@/lib/bookings/get-confirmed-booking";

export default async function DeliveryPage({
  searchParams,
}: {
  searchParams: { code?: string; email?: string; phone?: string; redirect_status?: string };
}) {
  const { code, redirect_status } = searchParams;

  if (!code) notFound();

  if (redirect_status !== "succeeded") {
    redirect(`/booking/confirmation?code=${code}&redirect_status=${redirect_status ?? ""}`);
  }

  const operator = await getOperatorRecord();
  if (!operator) notFound();

  const booking = await getConfirmedBooking(code, operator.id, operator.arriveMinutesBefore ?? null);
  if (!booking) notFound();

  return (
    <ConfirmedBookingView
      operatorName={operator.name ?? "Fishing Charter"}
      dockAddress={operator.dockAddress ?? null}
      phone={operator.phone ?? null}
      dockMapsUrl={operator.dockMapsUrl ?? null}
      booking={booking}
    />
  );
}
