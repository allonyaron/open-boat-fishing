import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireCustomer } from "@/lib/customer-auth";
import { bookings, bookingItems, tickets, trips, vessels, products } from "@openboat/db";
import { and, eq, inArray, desc } from "drizzle-orm";

export async function GET(req: NextRequest) {
  const auth = await requireCustomer(req);
  if (auth instanceof NextResponse) return auth;
  const { customer } = auth;

  const bookingRows = await db
    .select()
    .from(bookings)
    .where(
      and(eq(bookings.operatorId, customer.operatorId), eq(bookings.customerEmail, customer.email)),
    )
    .orderBy(desc(bookings.createdAt));

  if (bookingRows.length === 0) return NextResponse.json([]);

  const bookingIds = bookingRows.map((b) => b.id);

  const [itemRows, ticketRows] = await Promise.all([
    db
      .select({
        id: bookingItems.id,
        bookingId: bookingItems.bookingId,
        subtotalCents: bookingItems.subtotalCents,
        tripDepartureDate: trips.departureDate,
        tripStartTime: trips.startTime,
        tripEndTime: trips.endTime,
        tripStatus: trips.status,
        vesselName: vessels.name,
        vesselColor: vessels.color,
        productName: products.displayName,
      })
      .from(bookingItems)
      .innerJoin(trips, eq(bookingItems.tripId, trips.id))
      .innerJoin(vessels, eq(trips.vesselId, vessels.id))
      .innerJoin(products, eq(trips.productId, products.id))
      .where(inArray(bookingItems.bookingId, bookingIds)),
    db
      .select({
        id: tickets.id,
        bookingId: tickets.bookingId,
        bookingItemId: tickets.bookingItemId,
        ticketType: tickets.ticketType,
        priceCents: tickets.priceCents,
        voided: tickets.voided,
      })
      .from(tickets)
      .where(inArray(tickets.bookingId, bookingIds)),
  ]);

  const result = bookingRows.map((booking) => ({
    id: booking.id,
    confirmationCode: booking.confirmationCode,
    status: booking.status,
    totalCents: booking.totalCents,
    createdAt: booking.createdAt,
    items: itemRows
      .filter((i) => i.bookingId === booking.id)
      .map((item) => ({
        ...item,
        tickets: ticketRows.filter((t) => t.bookingItemId === item.id),
      })),
  }));

  return NextResponse.json(result);
}
