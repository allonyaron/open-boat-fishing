export const dynamic = "force-dynamic";

import { BookingCalendar, type Trip } from "@/components/BookingCalendar";
import { getOperatorRecord } from "@/lib/operator";

function currentMonth() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

export default async function BookPage({
  searchParams,
}: {
  searchParams: { date?: string; trip?: string };
}) {
  const { date, trip } = searchParams;
  // If a specific date is requested, fetch that month's trips
  const month = date?.match(/^\d{4}-\d{2}-\d{2}$/) ? date.slice(0, 7) : currentMonth();
  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL ?? "http://localhost:3000";
  const [res, operator] = await Promise.all([
    fetch(`${baseUrl}/api/trips?month=${month}`, { cache: "no-store" }),
    getOperatorRecord(),
  ]);
  const trips: Trip[] = await res.json();

  return (
    <BookingCalendar
      initialTrips={trips}
      initialMonth={month}
      operatorName={operator?.name ?? "Fishing Charter"}
      phone={operator?.phone ?? null}
      dockAddress={operator?.dockAddress ?? null}
      termsUrl={operator?.termsUrl ?? null}
      initialDate={date?.match(/^\d{4}-\d{2}-\d{2}$/) ? date : undefined}
      initialTripId={trip}
    />
  );
}
