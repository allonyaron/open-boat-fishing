import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { fmtTimeET } from "@/lib/format";
import { sendBookingConfirmation } from "@/lib/email";
import {
  bookings,
  bookingItems,
  tickets,
  trips,
  operators,
  vessels,
  products,
} from "@openboat/db";
import { eq, inArray } from "drizzle-orm";

export async function sendConfirmationEmail(
  booking: typeof bookings.$inferSelect,
  bookingId: string,
) {
  const [operator] = await db.select().from(operators).where(eq(operators.id, booking.operatorId));
  if (!operator) return;

  const itemRows = await db
    .select()
    .from(bookingItems)
    .where(eq(bookingItems.bookingId, bookingId));
  const tripIds = itemRows.map((i) => i.tripId);
  const [ticketRows, tripRows] = await Promise.all([
    db.select().from(tickets).where(eq(tickets.bookingId, bookingId)),
    tripIds.length > 0
      ? db.select().from(trips).where(inArray(trips.id, tripIds))
      : Promise.resolve([] as (typeof trips.$inferSelect)[]),
  ]);
  const vesselIds = [...new Set(tripRows.map((t) => t.vesselId))];
  const productIds = [...new Set(tripRows.map((t) => t.productId))];
  const [vesselRows, productRows] = await Promise.all([
    vesselIds.length > 0
      ? db.select().from(vessels).where(inArray(vessels.id, vesselIds))
      : Promise.resolve([] as (typeof vessels.$inferSelect)[]),
    productIds.length > 0
      ? db.select().from(products).where(inArray(products.id, productIds))
      : Promise.resolve([] as (typeof products.$inferSelect)[]),
  ]);

  const lineMap = new Map<
    string,
    { count: number; priceCents: number; tripId: string; ticketType: string }
  >();
  for (const t of ticketRows) {
    const item = itemRows.find((i) => i.id === t.bookingItemId)!;
    const key = `${item.tripId}:${t.ticketType}`;
    const existing = lineMap.get(key);
    if (existing) {
      existing.count += 1;
    } else {
      lineMap.set(key, {
        count: 1,
        priceCents: t.priceCents,
        tripId: item.tripId,
        ticketType: t.ticketType,
      });
    }
  }

  const ticketLines = [...lineMap.values()].map((l) => {
    const trip = tripRows.find((t) => t.id === l.tripId)!;
    const vessel = vesselRows.find((v) => v.id === trip.vesselId)!;
    const product = productRows.find((p) => p.id === trip.productId)!;
    return {
      ticketType: l.ticketType,
      count: l.count,
      priceCents: l.priceCents,
      tripDate: new Date(trip.departureDate + "T12:00:00").toLocaleDateString("en-US", {
        weekday: "long",
        month: "long",
        day: "numeric",
        year: "numeric",
      }),
      vesselName: vessel.name,
      productName: product.displayName,
      departs: fmtTimeET(trip.startTime),
      returns: fmtTimeET(trip.endTime),
    };
  });

  await sendBookingConfirmation({
    to: booking.customerEmail,
    customerName: booking.customerName,
    confirmationCode: booking.confirmationCode,
    bookingId,
    totalCents: booking.totalCents,
    ticketLines,
    fromAddress: operator.emailFrom,
    appUrl: env.NEXT_PUBLIC_APP_URL ?? "",
  });
}
