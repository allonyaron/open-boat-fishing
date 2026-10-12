// The one place money figures for a cart come from (P2-11). POST /api/bookings
// prices the cart with it under the trip locks, and POST /api/bookings/quote
// serves the same result to the checkout before any seat is held (P8-3), so
// the amount shown is the amount charged.

/** The platform's fee, $1.50 per ticket, taken out of the operator's share. */
export const PLATFORM_FEE_CENTS = 150;

// A group discount outside these bounds is treated as no discount (P7-5): at
// 100% or more the total is $0 or negative, and well before that the fee
// exceeds the charge. A threshold below 2 isn't a group.
const MIN_GROUP_DISCOUNT_PCT = 1;
const MAX_GROUP_DISCOUNT_PCT = 50;
const MIN_GROUP_DISCOUNT_THRESHOLD = 2;

export type CartInput = {
  tripId: string;
  tickets: { ticketType: string; quantity: number }[];
}[];

export type PricingTrip = {
  id: string;
  vesselId: string;
  productId: string;
  scheduleId: string | null;
};

export type ProductPrice = { productId: string; ticketType: string; priceCents: number };
export type SchedulePrice = { scheduleId: string; ticketType: string; priceCents: number };
export type PricingVessel = {
  id: string;
  groupDiscountThreshold: number | null;
  groupDiscountPct: number | null;
};

/** The fares that apply to a set of trips, as loaded by loadPricing. */
export type PriceBook = {
  productPrices: ProductPrice[];
  schedulePrices: SchedulePrice[];
  vessels: PricingVessel[];
};

export type PricedTicket = {
  ticketType: string;
  /** The fare before any discount. */
  listCents: number;
  /** What this ticket's share of the charge is: list price minus its share of the discount. */
  netCents: number;
  feeCents: number;
};

export type PricedFare = {
  ticketType: string;
  quantity: number;
  unitListCents: number;
  /** unitListCents × quantity. */
  listCents: number;
};

export type PricedLine = {
  tripId: string;
  fares: PricedFare[];
  /** One entry per seat, in fare order. The nets sum to netCents. */
  tickets: PricedTicket[];
  listCents: number;
  discountCents: number;
  netCents: number;
};

export type PricedCart = {
  lines: PricedLine[];
  listCents: number;
  discountCents: number;
  /** The amount charged. Equals the sum of every line's netCents. */
  totalCents: number;
  feeCents: number;
  ticketCount: number;
};

export class PricingError extends Error {
  constructor(
    message: string,
    readonly httpStatus: number,
  ) {
    super(message);
    this.name = "PricingError";
  }
}

/** A trip's price for one ticket type: the schedule's override, else the product's fare. */
export function findTicketPrice(trip: PricingTrip, ticketType: string, book: PriceBook): number | undefined {
  const scheduled =
    trip.scheduleId !== null
      ? book.schedulePrices.find((p) => p.scheduleId === trip.scheduleId && p.ticketType === ticketType)
      : undefined;
  if (scheduled) return scheduled.priceCents;
  return book.productPrices.find((p) => p.productId === trip.productId && p.ticketType === ticketType)
    ?.priceCents;
}

/**
 * Every ticket type a trip sells, at the price it sells for: the product's
 * fares with the schedule's overrides applied, plus any type only the
 * schedule prices. Sorted by ticket type.
 */
export function resolveTripPrices(
  trip: PricingTrip,
  book: PriceBook,
): { ticketType: string; priceCents: number }[] {
  const types = new Set<string>();
  for (const p of book.productPrices) if (p.productId === trip.productId) types.add(p.ticketType);
  if (trip.scheduleId !== null) {
    for (const p of book.schedulePrices) if (p.scheduleId === trip.scheduleId) types.add(p.ticketType);
  }
  return [...types].sort().map((ticketType) => ({
    ticketType,
    priceCents: findTicketPrice(trip, ticketType, book)!,
  }));
}

/** The vessel's group discount, or null when it has none or it's out of bounds. */
function groupDiscountOf(vessel: PricingVessel | undefined): { threshold: number; pct: number } | null {
  if (!vessel) return null;
  const { groupDiscountThreshold: threshold, groupDiscountPct: pct } = vessel;
  if (threshold === null && pct === null) return null;
  const valid =
    Number.isInteger(threshold) &&
    Number.isInteger(pct) &&
    threshold! >= MIN_GROUP_DISCOUNT_THRESHOLD &&
    pct! >= MIN_GROUP_DISCOUNT_PCT &&
    pct! <= MAX_GROUP_DISCOUNT_PCT;
  if (!valid) {
    console.warn(
      `[price-cart] vessel ${vessel.id}: ignoring group discount (threshold ${threshold}, pct ${pct})`,
    );
    return null;
  }
  return { threshold: threshold!, pct: pct! };
}

/**
 * Splits `amount` across `weights` in proportion, in whole cents, so the
 * shares sum to exactly `amount`. Leftover cents go to the largest
 * fractional parts, earlier entries first on a tie.
 */
function allocate(amount: number, weights: number[]): number[] {
  const totalWeight = weights.reduce((s, w) => s + w, 0);
  if (totalWeight === 0) return weights.map(() => 0);
  const shares = weights.map((w) => Math.floor((amount * w) / totalWeight));
  const remainders = weights.map((w, i) => ({ i, r: (amount * w) % totalWeight }));
  let left = amount - shares.reduce((s, x) => s + x, 0);
  remainders.sort((a, b) => b.r - a.r || a.i - b.i);
  for (const { i } of remainders) {
    if (left === 0) break;
    shares[i] += 1;
    left -= 1;
  }
  return shares;
}

function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Prices a cart. Pure: the caller loads `trips` (operator-scoped) and `book`.
 *
 * Each vessel whose group-discount threshold the cart meets takes
 * round(pct% of its tickets' list total) off, spread across those tickets
 * by list price, so every ticket's net is whole cents and the nets sum to
 * the total. The result doesn't depend on the order of the cart.
 *
 * Throws PricingError for a trip or fare it can't price (400) and for a total
 * that can't be charged (422).
 */
export function priceCart(cart: CartInput, trips: PricingTrip[], book: PriceBook): PricedCart {
  const tripById = new Map(trips.map((t) => [t.id, t]));
  const ordered = [...cart]
    .sort((a, b) => compare(a.tripId, b.tripId))
    .map((item) => ({ ...item, tickets: [...item.tickets].sort((a, b) => compare(a.ticketType, b.ticketType)) }));

  const lines: (PricedLine & { vesselId: string })[] = ordered.map((item) => {
    const trip = tripById.get(item.tripId);
    if (!trip) throw new PricingError(`Trip ${item.tripId} not found`, 400);
    const fares: PricedFare[] = [];
    const tickets: PricedTicket[] = [];
    for (const t of item.tickets) {
      if (t.quantity <= 0) continue;
      const unit = findTicketPrice(trip, t.ticketType, book);
      if (unit === undefined) {
        throw new PricingError(`No price found for ${t.ticketType} on trip ${item.tripId}`, 400);
      }
      fares.push({ ticketType: t.ticketType, quantity: t.quantity, unitListCents: unit, listCents: unit * t.quantity });
      for (let n = 0; n < t.quantity; n++) {
        tickets.push({ ticketType: t.ticketType, listCents: unit, netCents: unit, feeCents: PLATFORM_FEE_CENTS });
      }
    }
    const listCents = fares.reduce((s, f) => s + f.listCents, 0);
    return { tripId: item.tripId, vesselId: trip.vesselId, fares, tickets, listCents, discountCents: 0, netCents: listCents };
  });

  // Group discounts, per vessel, over every ticket on that vessel in the cart.
  const vesselIds = [...new Set(lines.map((l) => l.vesselId))];
  for (const vesselId of vesselIds) {
    const discount = groupDiscountOf(book.vessels.find((v) => v.id === vesselId));
    if (!discount) continue;
    const vesselLines = lines.filter((l) => l.vesselId === vesselId);
    const vesselTickets = vesselLines.flatMap((l) => l.tickets);
    if (vesselTickets.length < discount.threshold) continue;
    const vesselList = vesselTickets.reduce((s, t) => s + t.listCents, 0);
    const vesselDiscount = Math.round((vesselList * discount.pct) / 100);
    const shares = allocate(vesselDiscount, vesselTickets.map((t) => t.listCents));
    vesselTickets.forEach((t, i) => {
      t.netCents = t.listCents - shares[i];
    });
    for (const line of vesselLines) {
      line.netCents = line.tickets.reduce((s, t) => s + t.netCents, 0);
      line.discountCents = line.listCents - line.netCents;
    }
  }

  const listCents = lines.reduce((s, l) => s + l.listCents, 0);
  const totalCents = lines.reduce((s, l) => s + l.netCents, 0);
  const ticketCount = lines.reduce((s, l) => s + l.tickets.length, 0);
  const feeCents = PLATFORM_FEE_CENTS * ticketCount;

  // Stripe rejects a PaymentIntent whose application fee exceeds its amount.
  if (ticketCount === 0 || totalCents <= 0 || feeCents > totalCents) {
    throw new PricingError("These tickets can't be booked online. Please call the office.", 422);
  }

  return {
    lines: lines.map(({ vesselId: _vesselId, ...line }) => line),
    listCents,
    discountCents: listCents - totalCents,
    totalCents,
    feeCents,
    ticketCount,
  };
}
