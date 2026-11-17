import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireCustomer } from "@/lib/customer-auth";
import { bookings, bookingItems, tickets, trips, vessels, products } from "@openboat/db";
import { and, eq, inArray, desc, sql } from "drizzle-orm";
import { isTicketLive } from "@/lib/tickets/status";

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
        listPriceCents: sql<number>`coalesce(${tickets.listPriceCents}, ${tickets.priceCents})`,
        status: tickets.status,
        voided: tickets.voided,
      })
      .from(tickets)
      .where(and(inArray(tickets.bookingId, bookingIds), eq(tickets.operatorId, customer.operatorId))),
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
        // Installed apps read only `voided`: anything that can't board reads
        // as voided. `status` says which.
        tickets: ticketRows
          .filter((t) => t.bookingItemId === item.id)
          .map((t) => ({ ...t, voided: !isTicketLive(t) })),
      })),
  }));

  return NextResponse.json(result);
}
