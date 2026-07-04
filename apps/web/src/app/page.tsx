import { BookingCalendar } from "@/components/BookingCalendar";

function currentMonth() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

export default async function HomePage() {
  const month = currentMonth();
  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL ?? "http://localhost:3000";
  const res = await fetch(`${baseUrl}/api/trips?month=${month}`, { cache: "no-store" });
  const trips = await res.json();

  return <BookingCalendar initialTrips={trips} initialMonth={month} />;
}
