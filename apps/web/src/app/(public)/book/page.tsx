export const dynamic = "force-dynamic";

import { BookingCalendar, type Trip } from "@/components/BookingCalendar";
import { getOperatorRecord } from "@/lib/operator";

function currentMonth() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

export default async function BookPage() {
  const month = currentMonth();
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
      termsUrl={operator?.termsUrl ?? null}
    />
  );
}
