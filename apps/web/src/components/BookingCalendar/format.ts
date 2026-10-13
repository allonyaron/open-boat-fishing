import type { Trip } from "./types";

export const MONTHS = [
  "January","February","March","April","May","June",
  "July","August","September","October","November","December",
];
export const MONTHS_SHORT = ["JAN","FEB","MAR","APR","MAY","JUN","JUL","AUG","SEP","OCT","NOV","DEC"];
export const DAYS_SINGLE = ["S","M","T","W","T","F","S"];

export function toMonthStr(year: number, mon: number) {
  return `${year}-${String(mon).padStart(2, "0")}`;
}
export function parseMonth(month: string) {
  const [y, m] = month.split("-").map(Number);
  return { year: y, mon: m };
}
export function fmtDuration(startIso: string, endIso: string) {
  const diffMs = new Date(endIso).getTime() - new Date(startIso).getTime();
  const totalMins = Math.round(diffMs / 60000);
  const hrs = Math.floor(totalMins / 60);
  const mins = totalMins % 60;
  return mins === 0 ? `${hrs} hr` : `${hrs} hr ${mins} min`;
}
export function fmtDayLabel(dateStr: string): { main: string; sub: string } {
  const dt = new Date(dateStr + "T12:00:00Z");
  const today = new Date().toISOString().slice(0, 10);
  const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
  const dow = dt.toLocaleDateString("en-US", { weekday: "long", timeZone: "UTC" }).toUpperCase();
  const mon = dt.toLocaleDateString("en-US", { month: "long", timeZone: "UTC" }).toUpperCase();
  const day = dt.getUTCDate();
  const main = `${dow}, ${mon} ${day}`;
  const dow0 = dt.getUTCDay();
  const isWeekend = dow0 === 0 || dow0 === 6;
  let sub = "";
  if (dateStr === today) sub = "TODAY";
  else if (dateStr === tomorrow) sub = "TOMORROW";
  else if (isWeekend) sub = "WEEKEND";
  return { main, sub };
}
export function fmtMonthDay(dateStr: string) {
  const dt = new Date(dateStr + "T12:00:00Z");
  return `${MONTHS_SHORT[dt.getUTCMonth()]} ${dt.getUTCDate()}`;
}
export function getDisplayPrices(prices: Trip["product"]["prices"]) {
  const active = prices.filter((p) => p.priceCents > 0);
  if (active.length === 0) return [];
  const allEqual = active.every((p) => p.priceCents === active[0].priceCents);
  if (allEqual) return [{ ...active[0], displayLabel: "seat" }];
  return active.map((p) => ({ ...p, displayLabel: p.ticketType }));
}

/** At or below this many seats left, /book flags a trip as filling up. */
export const SEATS_LOW_THRESHOLD = 10;

export type SeatState = {
  kind: "open" | "low" | "full";
  /** What a calendar line shows on the right: a count, "FULL", or nothing. */
  count: string | null;
  /** The day panel's spelled-out state. */
  label: string;
};

/** One rule for the calendar lines and the day panel's trip cards. */
export function seatState(trip: {
  seatsRemaining: number;
  product: { showRemaining: boolean };
}): SeatState {
  const left = trip.seatsRemaining;
  if (left <= 0) return { kind: "full", count: "FULL", label: "SOLD OUT" };
  if (left <= SEATS_LOW_THRESHOLD) {
    return trip.product.showRemaining
      ? { kind: "low", count: String(left), label: `${left} SEAT${left === 1 ? "" : "S"} LEFT` }
      : { kind: "low", count: null, label: "ALMOST FULL" };
  }
  return { kind: "open", count: null, label: "SEATS OPEN" };
}

/** Start time for a calendar line: "5:00A", "12:30P" (Eastern). */
export function fmtLineTimeET(iso: string): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZone: "America/New_York",
  }).formatToParts(new Date(iso));
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("hour")}:${get("minute")}${get("dayPeriod").charAt(0).toUpperCase()}`;
}

/** "Saturday, November 14" for labels read aloud. */
export function fmtDayLong(dateStr: string): string {
  return new Date(dateStr + "T12:00:00Z").toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  });
}

/** "SUN NOV 1" for a cart item's date line. */
export function fmtDayShort(dateStr: string): string {
  const dt = new Date(dateStr + "T12:00:00Z");
  const dow = dt.toLocaleDateString("en-US", { weekday: "short", timeZone: "UTC" }).toUpperCase();
  return `${dow} ${MONTHS_SHORT[dt.getUTCMonth()]} ${dt.getUTCDate()}`;
}

/** "MV Open Boat II" → "OPEN BOAT II": the vessel-type prefix adds nothing in a tight line. */
export function vesselShort(name: string): string {
  return name.replace(/^(M\/?V|F\/?V)\s+/i, "").toUpperCase();
}

/** Today's date in Eastern time, "YYYY-MM-DD". */
export function todayET(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });
}
