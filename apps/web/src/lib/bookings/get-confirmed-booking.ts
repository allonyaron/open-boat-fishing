import "server-only";
import { db } from "@/lib/db";
import { bookings, bookingItems, trips, products, vessels, tickets } from "@openboat/db";
import { and, eq, count } from "drizzle-orm";
import { fmtTimeET } from "@/lib/format";
import { dollars } from "@openboat/utils";

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
  status: string;
  berthTime: string | null;
  whatToBring: string[];
  items: ConfirmedTripLine[];
};

export async function getConfirmedBooking(
  code: string,
  operatorId: string,
  arriveMinutesBefore: number | null,
): Promise<ConfirmedBooking | null> {
  const [booking] = await db
    .select()
    .from(bookings)
    .where(and(eq(bookings.confirmationCode, code), eq(bookings.operatorId, operatorId)));

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

  const ticketBreakdown = await db
    .select({
      tripId: bookingItems.tripId,
      ticketType: tickets.ticketType,
      priceCents: tickets.priceCents,
      qty: count(),
    })
    .from(tickets)
    .innerJoin(bookingItems, eq(bookingItems.id, tickets.bookingItemId))
    .where(eq(tickets.bookingId, booking.id))
    .groupBy(bookingItems.tripId, tickets.ticketType, tickets.priceCents);

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
    status: booking.status,
    berthTime,
    whatToBring: Array.from(whatToBringSet),
    items,
  };
}
