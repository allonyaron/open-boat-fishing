import type { Trip } from "./types";

export const MONTHS = [
  "January","February","March","April","May","June",
  "July","August","September","October","November","December",
];
export const DAYS_LONG = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];
export const DAYS_SHORT = ["SUN","MON","TUE","WED","THU","FRI","SAT"];

export function toMonthStr(year: number, mon: number) {
  return `${year}-${String(mon).padStart(2,"0")}`;
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
export function fmtFullDate(dateStr: string) {
  const dt = new Date(dateStr + "T12:00:00Z");
  const dow = DAYS_LONG[dt.getUTCDay()];
  const mon = MONTHS[dt.getUTCMonth()];
  const day = dt.getUTCDate();
  return `${dow}, ${mon} ${day}`;
}
export function dollars(cents: number) {
  return `$${Math.round(cents / 100)}`;
}
// Pluralize a ticket label for cart copy.
export function pluralLabel(label: string, qty: number): string {
  if (qty === 1) return label;
  const map: Record<string, string> = {
    seat: "seats", adult: "adults", child: "children",
    senior: "seniors", military: "military",
  };
  return map[label.toLowerCase()] ?? label + "s";
}

// Returns display rows for the trip's seat selector.
// If all active prices are equal, collapses to a single "Seats" row keyed on first ticketType.
export function getDisplayPrices(prices: Trip["product"]["prices"]) {
  const active = prices.filter((p) => p.priceCents > 0);
  if (active.length === 0) return [];
  const allEqual = active.every((p) => p.priceCents === active[0].priceCents);
  if (allEqual) {
    return [{ ...active[0], displayLabel: "seat" }];
  }
  return active.map((p) => ({ ...p, displayLabel: p.ticketType }));
}
