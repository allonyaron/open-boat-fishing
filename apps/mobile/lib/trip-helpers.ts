import { fmtTime } from "@openboat/utils";
import { tripType } from "@/constants/nativeTokens";

export type Price = {
  id: string;
  ticketType: string; // "adult" | "child" | "senior"
  priceCents: number;
};

export type Trip = {
  id: string;
  departureDate: string; // "YYYY-MM-DD"
  startTime: string; // ISO timestamptz
  endTime: string; // ISO timestamptz
  capacity: number;
  seatsRemaining: number;
  vessel: { id: string; name: string; color: string };
  product: { id: string; category: string; displayName: string; prices: Price[] };
};

export type CartKey = string; // "tripId:ticketType"
export type Cart = Record<CartKey, number>;

export function cartKey(tripId: string, ticketType: string): CartKey {
  return `${tripId}:${ticketType}`;
}

export function dollars(cents: number): string {
  return `$${Math.round(cents / 100)}`;
}

export function fmtDuration(startIso: string, endIso: string): string {
  const totalMins = Math.round((new Date(endIso).getTime() - new Date(startIso).getTime()) / 60000);
  const hrs = Math.floor(totalMins / 60);
  const mins = totalMins % 60;
  return mins === 0 ? `${hrs} HR` : `${hrs} HR ${mins} MIN`;
}

/** Mirrors getDisplayPrices in apps/web/src/components/BookingCalendar.tsx exactly. */
export function getDisplayPrices(prices: Price[]): (Price & { displayLabel: string })[] {
  const active = prices.filter((p) => p.priceCents > 0);
  if (active.length === 0) return [];
  const allEqual = active.every((p) => p.priceCents === active[0].priceCents);
  if (allEqual) return [{ ...active[0], displayLabel: "seat" }];
  return active.map((p) => ({ ...p, displayLabel: p.ticketType }));
}

/** Trip-type color bar: category first, vessel color as fallback for unmapped categories. */
export function tripTypeColor(category: string, vesselColor: string): string {
  const key = category.toLowerCase() as keyof typeof tripType;
  return tripType[key]?.color ?? vesselColor;
}

export function tripTypeLabel(category: string): string {
  const key = category.toLowerCase() as keyof typeof tripType;
  return tripType[key]?.label ?? category.toUpperCase();
}

export function cartQtyForTrip(cart: Cart, trip: Trip): number {
  return trip.product.prices.reduce((sum, p) => sum + (cart[cartKey(trip.id, p.ticketType)] ?? 0), 0);
}

export function cartTotalCentsForTrip(cart: Cart, trip: Trip): number {
  return trip.product.prices.reduce((sum, p) => sum + (cart[cartKey(trip.id, p.ticketType)] ?? 0) * p.priceCents, 0);
}

export function fmtTimeRange(startIso: string, endIso: string): string {
  return `${fmtTime(startIso)} – ${fmtTime(endIso)}`;
}

export function fmtHoldTime(secs: number): string {
  const m = Math.floor(secs / 60);
  const s = Math.max(0, secs % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}
