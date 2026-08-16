import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireMate } from "@/lib/mate-auth";
import { trips, vessels, products, bookingItems, tickets, checkIns } from "@openboat/db";
import { and, eq, sql } from "drizzle-orm";

export async function GET(req: NextRequest) {
  const auth = await requireMate(req);
  if (auth instanceof NextResponse) return auth;
  const { staff } = auth;

  // Client passes its local date so we don't compute "today" in UTC on the
  // server (which would be wrong for East Coast operators after 8 PM ET).
  const today = req.nextUrl.searchParams.get("date") ?? new Date().toISOString().slice(0, 10);

  const tripRows = await db
    .select({
      id: trips.id,
      departureDate: trips.departureDate,
      startTime: trips.startTime,
      endTime: trips.endTime,
      boardingTime: trips.boardingTime,
      capacity: trips.capacity,
      seatsRemaining: trips.seatsRemaining,
      status: trips.status,
      vessel: {
        id: vessels.id,
        name: vessels.name,
        color: vessels.color,
        certificateCapacity: vessels.certificateCapacity,
      },
      product: { id: products.id, displayName: products.displayName, category: products.category },
      ticketsSold: sql<number>`(
        select count(*) from ${tickets} t
        join ${bookingItems} bi on bi.id = t.booking_item_id
        where bi.trip_id = ${trips.id}
          and t.voided = false
      )`.as("tickets_sold"),
      checkedIn: sql<number>`(
        select count(*) from ${checkIns} ci
        where ci.trip_id = ${trips.id}
      )`.as("checked_in"),
    })
    .from(trips)
    .innerJoin(vessels, eq(trips.vesselId, vessels.id))
    .innerJoin(products, eq(trips.productId, products.id))
    .where(and(eq(trips.operatorId, staff.operatorId), eq(trips.departureDate, today)))
    .orderBy(trips.startTime);

  return NextResponse.json(tripRows);
}
