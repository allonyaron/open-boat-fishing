import type { APIRequestContext } from "@playwright/test";

type ListedTrip = {
  id: string;
  departureDate: string;
  seatsRemaining: number;
  product: { prices: { ticketType: string; priceCents: number }[] };
};

/**
 * "YYYY-MM" for the month after this one: fully in the future. Counted from
 * the month in Eastern time, which /book opens on (currentMonthET), so it is
 * the month "Next month" loads even late on the last day of a month.
 */
export function nextMonth(offset = 1): string {
  const [y, m] = new Date()
    .toLocaleDateString("en-CA", { timeZone: "America/New_York" })
    .split("-")
    .map(Number);
  const d = new Date(Date.UTC(y, m - 1 + offset, 1));
  return d.toISOString().slice(0, 7);
}

export async function tripsFor(request: APIRequestContext, month: string): Promise<ListedTrip[]> {
  const res = await request.get(`/api/trips?month=${month}`);
  if (!res.ok()) throw new Error(`/api/trips?month=${month}: ${res.status()}`);
  return res.json();
}

/**
 * A day from the 15th of next month on with a trip that has seats (and, with
 * `adult`, separate adult and child fares). /book?date= opens that day's
 * panel on desktop, so a spec can't assume a fixed date has trips.
 */
export async function bookableDate(request: APIRequestContext, opts: { adult?: boolean } = {}): Promise<string> {
  const month = nextMonth();
  const trips = await tripsFor(request, month);
  const ok = (t: ListedTrip) => {
    if (t.seatsRemaining < 2 || t.departureDate < `${month}-15`) return false;
    if (!opts.adult) return true;
    const prices = t.product.prices.filter((p) => p.priceCents > 0);
    return prices.some((p) => p.ticketType === "adult") && new Set(prices.map((p) => p.priceCents)).size > 1;
  };
  const trip = trips.find(ok);
  if (!trip) throw new Error(`No suitable trip in ${month} from the 15th on`);
  return trip.departureDate;
}
