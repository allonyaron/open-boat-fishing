// This file is intentionally a duplicate of app/page.tsx to avoid a Next.js
// route-group conflict. Real admin pages live at app/admin/*.
import { BookingCalendar } from "@/components/BookingCalendar";
import { db } from "@/lib/db";
import { operators } from "@openboat/db";

function currentMonth() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

export default async function HomePage() {
  const month = currentMonth();
  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL ?? "http://localhost:3000";
  const [res, operatorRow] = await Promise.all([
    fetch(`${baseUrl}/api/trips?month=${month}`, { cache: "no-store" }),
    db.select({ name: operators.name, termsUrl: operators.termsUrl }).from(operators).limit(1),
  ]);
  const trips = await res.json();
  const operatorName = operatorRow[0]?.name ?? "Fishing Charter";
  const termsUrl = operatorRow[0]?.termsUrl ?? null;
  return (
    <BookingCalendar
      initialTrips={trips}
      initialMonth={month}
      operatorName={operatorName}
      termsUrl={termsUrl}
    />
  );
}
