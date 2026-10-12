import { db } from "@/lib/db";
import { todayET } from "@/lib/date-et";
import { onlineSalesOpenSql } from "@/lib/trips/online-sales";
import { loadPriceBook } from "@/lib/bookings/price-book";
import { resolveTripPrices } from "@/lib/bookings/price-cart";

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

/** True for a YYYY-MM string with a real month (01–12). */
export function isValidMonth(month: string): boolean {
  return MONTH_RE.test(month);
}

/**
 * The current month as YYYY-MM in America/New_York. The server's clock is UTC,
 * which rolls to next month at 8 PM ET on the last evening of a month.
 */
export function currentMonthET(): string {
  return todayET().slice(0, 7);
}

/**
 * The bookable trips in one month: scheduled, still open for online sales
 * (not departed, not past their cutoff), ordered by date and start time.
 * Shared by GET /api/trips and the /book server render, so both list the
 * same trips. `month` must pass isValidMonth.
 *
 * Each trip's `product.prices` are the prices it sells at: the product's
 * active fares with the schedule's overrides applied, as the booking route
 * charges them (P8-3).
 */
export async function getTripsForMonth(operatorId: string, month: string, now: Date = new Date()) {
  const [year, mon] = month.split("-").map(Number);
  const startDate = `${month}-01`;
  const lastDay = new Date(Date.UTC(year, mon, 0)).getUTCDate();
  const endDate = `${month}-${String(lastDay).padStart(2, "0")}`;

  const rows = await db.query.trips.findMany({
    where: (t, { eq, and, gte, lte }) =>
      and(
        eq(t.operatorId, operatorId),
        gte(t.departureDate, startDate),
        lte(t.departureDate, endDate),
        eq(t.status, "scheduled"),
        // Departed trips, and trips past their online-sales cutoff, aren't bookable.
        onlineSalesOpenSql(t, now),
      ),
    with: {
      vessel: true,
      product: true,
    },
    orderBy: (t, { asc }) => [asc(t.departureDate), asc(t.startTime)],
  });

  const book = await loadPriceBook(operatorId, rows);
  return rows.map((trip) => ({
    ...trip,
    product: { ...trip.product, prices: resolveTripPrices(trip, book) },
  }));
}

export type MonthTrip = Awaited<ReturnType<typeof getTripsForMonth>>[number];
