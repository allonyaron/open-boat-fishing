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
export function dollars(cents: number) {
  return `$${Math.round(cents / 100)}`;
}
export function fmtMonthDay(dateStr: string) {
  const dt = new Date(dateStr + "T12:00:00Z");
  return `${MONTHS_SHORT[dt.getUTCMonth()]} ${dt.getUTCDate()}`;
}
export function fmtHoldTime(secs: number): string {
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function getDisplayPrices(prices: Trip["product"]["prices"]) {
  const active = prices.filter((p) => p.priceCents > 0);
  if (active.length === 0) return [];
  const allEqual = active.every((p) => p.priceCents === active[0].priceCents);
  if (allEqual) return [{ ...active[0], displayLabel: "seat" }];
  return active.map((p) => ({ ...p, displayLabel: p.ticketType }));
}
