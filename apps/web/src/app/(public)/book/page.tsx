export const dynamic = "force-dynamic";

import { BookingCalendar, type Trip } from "@/components/BookingCalendar";
import { getOperatorRecord } from "@/lib/operator";
import { currentMonthET, getTripsForMonth, isValidMonth, type MonthTrip } from "@/lib/trips/month";

// The calendar's Trip is the /api/trips JSON shape (ISO strings for times);
// month navigation fetches that route, so the first month must match it.
function toCalendarTrip(t: MonthTrip): Trip {
  return {
    id: t.id,
    departureDate: t.departureDate,
    startTime: t.startTime.toISOString(),
    endTime: t.endTime.toISOString(),
    capacity: t.capacity,
    seatsRemaining: t.seatsRemaining,
    vessel: { name: t.vessel.name, color: t.vessel.color, code: t.vessel.code },
    product: {
      category: t.product.category,
      displayName: t.product.displayName,
      showRemaining: t.product.showRemaining,
      prices: t.product.prices.map((p) => ({ ticketType: p.ticketType, priceCents: p.priceCents })),
    },
  };
}

export default async function BookPage({
  searchParams,
}: {
  searchParams: { date?: string; trip?: string };
}) {
  const operator = await getOperatorRecord();
  if (!operator) return null;

  const { date, trip } = searchParams;
  const initialDate =
    date && /^\d{4}-\d{2}-\d{2}$/.test(date) && isValidMonth(date.slice(0, 7)) ? date : undefined;
  // If a specific date is requested, open that date's month.
  const month = initialDate?.slice(0, 7) ?? currentMonthET();
  const trips = (await getTripsForMonth(operator.id, month)).map(toCalendarTrip);

  return (
    <BookingCalendar
      initialTrips={trips}
      initialMonth={month}
      operatorName={operator.name}
      phone={operator.phone}
      dockAddress={operator.dockAddress}
      termsUrl={operator.termsUrl}
      initialDate={initialDate}
      initialTripId={trip}
    />
  );
}
