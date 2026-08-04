import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/session";
import { trips, vessels, products, bookingItems, tickets } from "@openboat/db";
import { and, eq, gte, sql } from "drizzle-orm";

export async function GET(req: NextRequest) {
  const auth = await requireAdmin(req);
  if (auth instanceof NextResponse) return auth;
  const { session } = auth;

  const { searchParams } = new URL(req.url);
  const from = searchParams.get("from") ?? new Date().toISOString().slice(0, 10);
  const limit = Math.min(Number(searchParams.get("limit") ?? 60), 200);

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
      sailedAt: trips.sailedAt,
      cancelledAt: trips.cancelledAt,
      cancellationReason: trips.cancellationReason,
      vessel: {
        id: vessels.id,
        name: vessels.name,
        color: vessels.color,
      },
      product: {
        id: products.id,
        displayName: products.displayName,
        category: products.category,
      },
      ticketsSold: sql<number>`(
        select count(*) from ${tickets} t
        join ${bookingItems} bi on bi.id = t.booking_item_id
        where bi.trip_id = ${trips.id}
          and t.voided = false
      )`.as("tickets_sold"),
    })
    .from(trips)
    .innerJoin(vessels, eq(trips.vesselId, vessels.id))
    .innerJoin(products, eq(trips.productId, products.id))
    .where(
      and(
        eq(trips.operatorId, session.operatorId),
        gte(trips.departureDate, from)
      )
    )
    .orderBy(trips.startTime)
    .limit(limit);

  return NextResponse.json(tripRows);
}
