import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireMate } from "@/lib/mate-auth";
import { trips, vessels, products, bookings, bookingItems, tickets, checkIns } from "@openboat/db";
import { and, eq, inArray, sql } from "drizzle-orm";

export async function GET(req: NextRequest) {
  const auth = await requireMate(req);
  if (auth instanceof NextResponse) return auth;
  const { staff } = auth;

  const tripId = new URL(req.url).searchParams.get("tripId");
  if (!tripId) {
    return NextResponse.json({ error: "tripId required" }, { status: 400 });
  }

  const [trip] = await db
    .select({
      id: trips.id,
      departureDate: trips.departureDate,
      startTime: trips.startTime,
      endTime: trips.endTime,
      boardingTime: trips.boardingTime,
      capacity: trips.capacity,
      seatsRemaining: trips.seatsRemaining,
      status: trips.status,
      vessel: { id: vessels.id, name: vessels.name, color: vessels.color, certificateCapacity: vessels.certificateCapacity },
      product: { id: products.id, displayName: products.displayName, category: products.category },
      ticketsSold: sql<number>`(
        select count(*) from ${tickets} t
        join ${bookingItems} bi on bi.id = t.booking_item_id
        where bi.trip_id = ${trips.id} and t.voided = false
      )`.as("tickets_sold"),
    })
    .from(trips)
    .innerJoin(vessels, eq(trips.vesselId, vessels.id))
    .innerJoin(products, eq(trips.productId, products.id))
    .where(and(eq(trips.id, tripId), eq(trips.operatorId, staff.operatorId)));

  if (!trip) {
    return NextResponse.json({ error: "Trip not found" }, { status: 404 });
  }

  const itemRows = await db
    .select()
    .from(bookingItems)
    .where(eq(bookingItems.tripId, tripId));

  if (itemRows.length === 0) {
    return NextResponse.json({ trip, bookings: [] });
  }

  const bookingIds = [...new Set(itemRows.map((i) => i.bookingId))];
  const itemIds = itemRows.map((i) => i.id);

  const [bookingRows, ticketRows, checkInRows] = await Promise.all([
    db
      .select({
        id: bookings.id,
        confirmationCode: bookings.confirmationCode,
        customerName: bookings.customerName,
        customerEmail: bookings.customerEmail,
        customerPhone: bookings.customerPhone,
        status: bookings.status,
      })
      .from(bookings)
      .where(inArray(bookings.id, bookingIds)),
    db
      .select({
        id: tickets.id,
        bookingItemId: tickets.bookingItemId,
        ticketType: tickets.ticketType,
        passengerName: tickets.passengerName,
        qrPayload: tickets.qrPayload,
        voided: tickets.voided,
      })
      .from(tickets)
      .where(inArray(tickets.bookingItemId, itemIds)),
    db
      .select({
        ticketId: checkIns.ticketId,
        method: checkIns.method,
        checkedInAt: checkIns.checkedInAt,
      })
      .from(checkIns)
      .where(eq(checkIns.tripId, tripId)),
  ]);

  const checkInByTicket = new Map(checkInRows.map((c) => [c.ticketId, c]));

  const bookingList = bookingRows
    .map((b) => {
      const items = itemRows.filter((i) => i.bookingId === b.id);
      const ticketList = ticketRows
        .filter((t) => items.some((i) => i.id === t.bookingItemId))
        .map((t) => {
          const ci = checkInByTicket.get(t.id);
          return {
            id: t.id,
            ticketType: t.ticketType,
            passengerName: t.passengerName,
            qrPayload: t.qrPayload,
            voided: t.voided,
            checkedIn: !!ci,
            checkedInAt: ci?.checkedInAt?.toISOString() ?? null,
            checkInMethod: ci?.method ?? null,
          };
        });
      return { ...b, tickets: ticketList };
    })
    .sort((a, b) => (a.customerName ?? "").localeCompare(b.customerName ?? ""));

  return NextResponse.json({ trip, bookings: bookingList });
}
