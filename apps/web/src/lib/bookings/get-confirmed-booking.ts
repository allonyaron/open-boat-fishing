import "server-only";
import { db } from "@/lib/db";
import { bookings, bookingItems, trips, products, vessels, tickets } from "@openboat/db";
import { and, eq, count, sql } from "drizzle-orm";
import { fmtTimeET } from "@/lib/format";
import { dollars } from "@openboat/utils";
import { boardingPassPath } from "./booking-key";

function fmtDateShort(d: string) {
  return new Date(d + "T12:00:00Z").toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

function capitalize(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export type ConfirmedTripLine = {
  tripId: string;
  productName: string;
  meta: string;
  ticketLines: string[];
  subtotalLabel: string;
};

export type ConfirmedBooking = {
  bookingId: string;
  confirmationCode: string;
  /** Opens the boarding passes: the booking id with its key. */
  boardingPath: string;
  berthTime: string | null;
  whatToBring: string[];
  items: ConfirmedTripLine[];
};

/**
 * The confirmation page's view of a paid booking, or null unless the booking is
 * confirmed. Callers check access first (`resolveBookingPage`): this takes the
 * booking id, never a confirmation code.
 */
export async function getConfirmedBooking(
  bookingId: string,
  operatorId: string,
  arriveMinutesBefore: number | null,
): Promise<ConfirmedBooking | null> {
  const [booking] = await db
    .select()
    .from(bookings)
    .where(
      and(eq(bookings.id, bookingId), eq(bookings.operatorId, operatorId), eq(bookings.status, "confirmed")),
    );

  if (!booking) return null;

  const tripRows = await db
    .select({
      tripId: trips.id,
      tripDate: trips.departureDate,
      startTime: trips.startTime,
      endTime: trips.endTime,
      productName: products.displayName,
      whatToBring: products.whatToBring,
      vesselName: vessels.name,
      subtotal: bookingItems.subtotalCents,
    })
    .from(bookingItems)
    .innerJoin(trips, eq(trips.id, bookingItems.tripId))
    .innerJoin(products, eq(products.id, trips.productId))
    .innerJoin(vessels, eq(vessels.id, trips.vesselId))
    .where(eq(bookingItems.bookingId, booking.id));

  // Lines show the fare (list price); the subtotal is what was charged.
  const fare = sql<number>`coalesce(${tickets.listPriceCents}, ${tickets.priceCents})`;
  const ticketBreakdown = await db
    .select({
      tripId: bookingItems.tripId,
      ticketType: tickets.ticketType,
      priceCents: fare,
      qty: count(),
    })
    .from(tickets)
    .innerJoin(bookingItems, eq(bookingItems.id, tickets.bookingItemId))
    .where(eq(tickets.bookingId, booking.id))
    .groupBy(bookingItems.tripId, tickets.ticketType, fare);

  const linesByTrip = new Map<string, string[]>();
  for (const row of ticketBreakdown) {
    const label = `${row.qty} × ${capitalize(row.ticketType)} · ${dollars(row.priceCents)}`;
    const existing = linesByTrip.get(row.tripId) ?? [];
    existing.push(label);
    linesByTrip.set(row.tripId, existing);
  }

  const items: ConfirmedTripLine[] = tripRows.map((t) => ({
    tripId: t.tripId,
    productName: t.productName,
    meta: `${fmtDateShort(t.tripDate)} · ${fmtTimeET(t.startTime)} – ${fmtTimeET(t.endTime)} · ${t.vesselName}`,
    ticketLines: linesByTrip.get(t.tripId) ?? [],
    subtotalLabel: dollars(t.subtotal),
  }));

  const earliestStart = tripRows.reduce(
    (min, item) => Math.min(min, new Date(item.startTime).getTime()),
    Infinity,
  );
  const berthTime =
    isFinite(earliestStart) && arriveMinutesBefore != null
      ? fmtTimeET(new Date(earliestStart - arriveMinutesBefore * 60 * 1000).toISOString())
      : null;

  const whatToBringSet = new Set<string>();
  for (const item of tripRows) {
    for (const thing of item.whatToBring ?? []) whatToBringSet.add(thing);
  }

  return {
    bookingId: booking.id,
    confirmationCode: booking.confirmationCode,
    boardingPath: boardingPassPath(operatorId, booking.id),
    berthTime,
    whatToBring: Array.from(whatToBringSet),
    items,
  };
}
