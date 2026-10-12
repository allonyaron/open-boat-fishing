// The cart model both clients share (P8-16). Each client keeps one cart store
// (web: localStorage, mobile: MMKV) built on these pure functions. A cart line
// is a snapshot of the trip as it was listed plus a quantity per ticket type.
// Prices in the snapshot are for display next to a fare; every total comes
// from the server's quote (POST /api/bookings/quote, P8-3).

/** The trip fields the cart needs. Both clients' Trip types have them. */
export type CartTrip = {
  id: string;
  departureDate: string;
  seatsRemaining: number;
  product: { prices: { ticketType: string; priceCents: number }[] };
};

export type CartLine<T extends CartTrip = CartTrip> = {
  trip: T;
  /** Seats per ticket type; every entry is ≥ 1. */
  quantities: Record<string, number>;
};

/** A stored cart older than this is dropped on load (P8-3). */
export const CART_MAX_AGE_MS = 24 * 60 * 60 * 1000;

const STORED_CART_VERSION = 2;

type StoredCart<T extends CartTrip> = { version: number; savedAt: number; lines: CartLine<T>[] };

export function serializeCart<T extends CartTrip>(lines: CartLine<T>[], now = Date.now()): string {
  const stored: StoredCart<T> = { version: STORED_CART_VERSION, savedAt: now, lines };
  return JSON.stringify(stored);
}

/**
 * Reads a stored cart. Anything unreadable, from an older version, or older
 * than CART_MAX_AGE_MS comes back empty.
 */
export function parseStoredCart<T extends CartTrip>(raw: string | null | undefined, now = Date.now()): CartLine<T>[] {
  if (!raw) return [];
  try {
    const stored = JSON.parse(raw) as Partial<StoredCart<T>>;
    if (stored?.version !== STORED_CART_VERSION || !Array.isArray(stored.lines)) return [];
    if (typeof stored.savedAt !== "number" || now - stored.savedAt > CART_MAX_AGE_MS) return [];
    return stored.lines.filter(
      (l) => l && typeof l.trip?.id === "string" && l.quantities && seatsInLine(l) > 0,
    );
  } catch {
    return [];
  }
}

export function seatsInLine(line: CartLine<CartTrip>): number {
  return Object.values(line.quantities).reduce((s, q) => s + q, 0);
}

export function totalSeats(lines: CartLine<CartTrip>[]): number {
  return lines.reduce((s, l) => s + seatsInLine(l), 0);
}

export function quantityOf(lines: CartLine<CartTrip>[], tripId: string, ticketType: string): number {
  return lines.find((l) => l.trip.id === tripId)?.quantities[ticketType] ?? 0;
}

/**
 * Sets one fare's quantity on a trip, capped so the trip's fares together
 * don't exceed its seats. Refreshes the line's trip snapshot from `trip`.
 * A line with no seats left is removed; a new line goes last.
 */
export function setQuantity<T extends CartTrip>(
  lines: CartLine<T>[],
  trip: T,
  ticketType: string,
  quantity: number,
): CartLine<T>[] {
  const existing = lines.find((l) => l.trip.id === trip.id);
  const quantities = { ...(existing?.quantities ?? {}) };
  const others = Object.entries(quantities)
    .filter(([type]) => type !== ticketType)
    .reduce((s, [, q]) => s + q, 0);
  const capped = Math.max(0, Math.min(Math.floor(quantity), trip.seatsRemaining - others));
  if (capped > 0) quantities[ticketType] = capped;
  else delete quantities[ticketType];

  if (Object.keys(quantities).length === 0) return lines.filter((l) => l.trip.id !== trip.id);
  const line = { trip, quantities };
  return existing ? lines.map((l) => (l.trip.id === trip.id ? line : l)) : [...lines, line];
}

export function adjustQuantity<T extends CartTrip>(
  lines: CartLine<T>[],
  trip: T,
  ticketType: string,
  delta: number,
): CartLine<T>[] {
  return setQuantity(lines, trip, ticketType, quantityOf(lines, trip.id, ticketType) + delta);
}

export function removeTrip<T extends CartTrip>(lines: CartLine<T>[], tripId: string): CartLine<T>[] {
  return lines.filter((l) => l.trip.id !== tripId);
}

/** The fares in a line, in the order the trip lists them. */
export function lineFares(line: CartLine<CartTrip>): { ticketType: string; quantity: number; priceCents: number }[] {
  const listed = line.trip.product.prices.map((p) => p.ticketType);
  const types = [
    ...listed.filter((t) => line.quantities[t]),
    ...Object.keys(line.quantities).filter((t) => !listed.includes(t)),
  ];
  return types.map((ticketType) => ({
    ticketType,
    quantity: line.quantities[ticketType],
    priceCents: line.trip.product.prices.find((p) => p.ticketType === ticketType)?.priceCents ?? 0,
  }));
}

export type ApiCart = { tripId: string; tickets: { ticketType: string; quantity: number }[] }[];

/** The cart as POST /api/bookings and the quote take it. */
export function toApiCart(lines: CartLine<CartTrip>[]): ApiCart {
  return lines.map((l) => ({
    tripId: l.trip.id,
    tickets: lineFares(l).map(({ ticketType, quantity }) => ({ ticketType, quantity })),
  }));
}

/**
 * A stable fingerprint of what the cart holds (trips, fares, quantities),
 * independent of order. The web checkout stores it with its booking to tell
 * whether the booking still matches the cart (P2-3).
 */
export function cartKey(lines: CartLine<CartTrip>[]): string {
  return toApiCart(lines)
    .flatMap((item) => item.tickets.map((t) => `${item.tripId}:${t.ticketType}:${t.quantity}`))
    .sort()
    .join(",");
}

/** The months (YYYY-MM) the cart's trips depart in. */
export function cartMonths(lines: CartLine<CartTrip>[]): string[] {
  return [...new Set(lines.map((l) => l.trip.departureDate.slice(0, 7)))].sort();
}

/**
 * Brings a restored cart up to date with freshly listed trips (P8-3). Only
 * lines departing in `months` are checked, and `fresh` must hold every
 * listed trip in those months; lines in other months (added while the trips
 * were loading) are left alone. A checked line takes the fresh snapshot
 * (prices, seats); a trip no longer listed (cancelled, departed, past its
 * cutoff) or a fare no longer sold is dropped.
 *
 * Quantities are not cut to the listed seats: the listing already subtracts
 * this customer's own held booking, so cutting would shrink a cart whose
 * seats are held (and change its cartKey, releasing the hold). The booking
 * decides seats, as the quote leaves them to it.
 *
 * `changed` is true when a price changed or anything was dropped.
 */
export function reconcileCart<T extends CartTrip>(
  lines: CartLine<T>[],
  fresh: T[],
  months: string[],
): { lines: CartLine<T>[]; changed: boolean } {
  const byId = new Map(fresh.map((t) => [t.id, t]));
  const checked = new Set(months);
  let changed = false;
  const next: CartLine<T>[] = [];
  for (const line of lines) {
    if (!checked.has(line.trip.departureDate.slice(0, 7))) {
      next.push(line);
      continue;
    }
    const trip = byId.get(line.trip.id);
    if (!trip) {
      changed = true;
      continue;
    }
    const before = lineFares(line);
    const sold = new Set(trip.product.prices.map((p) => p.ticketType));
    const quantities: Record<string, number> = {};
    for (const fare of before) {
      if (sold.has(fare.ticketType)) quantities[fare.ticketType] = fare.quantity;
      else changed = true;
    }
    if (
      before.some(
        (f) => sold.has(f.ticketType) && trip.product.prices.find((p) => p.ticketType === f.ticketType)?.priceCents !== f.priceCents,
      )
    ) {
      changed = true;
    }
    if (Object.keys(quantities).length > 0) next.push({ trip, quantities });
  }
  return { lines: next, changed };
}

// ─── Quote ────────────────────────────────────────────────────────────────────

/** POST /api/bookings/quote's response. */
export type Quote = {
  lines: {
    tripId: string;
    fares: { ticketType: string; quantity: number; unitListCents: number; listCents: number }[];
    listCents: number;
    discountCents: number;
    totalCents: number;
  }[];
  listCents: number;
  discountCents: number;
  totalCents: number;
  ticketCount: number;
};
