import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/session";
import { trips, vessels, products, bookingItems, tickets } from "@openboat/db";
import { and, eq, gte, sql } from "drizzle-orm";
import { parseTime, toTimeString, isOvernight, tripEndDate } from "@/lib/trip-materialization";

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
      scheduleId: trips.scheduleId,
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
        select cast(count(*) as int) from ${tickets} t
        join ${bookingItems} bi on bi.id = t.booking_item_id
        where bi.trip_id = ${trips.id}
          and t.voided = false
      )`.as("tickets_sold"),
    })
    .from(trips)
    .innerJoin(vessels, eq(trips.vesselId, vessels.id))
    .innerJoin(products, eq(trips.productId, products.id))
    .where(and(eq(trips.operatorId, session.operatorId), gte(trips.departureDate, from)))
    .orderBy(trips.startTime)
    .limit(limit);

  return NextResponse.json(tripRows);
}

// "Add a departure" — a one-off trip outside any weekly pattern (scheduleId
// stays null). Doesn't touch schedules; the trip stands alone on the calendar
// with the "Added" status.
export async function POST(req: NextRequest) {
  const auth = await requireAdmin(req);
  if (auth instanceof NextResponse) return auth;
  const { session } = auth;

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;

  const productId = String(body.productId ?? "").trim();
  if (!productId) return NextResponse.json({ error: "productId is required" }, { status: 400 });

  const departureDate = String(body.departureDate ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(departureDate))
    return NextResponse.json({ error: "departureDate must be YYYY-MM-DD" }, { status: 400 });

  const depParsed = parseTime(String(body.departureTime ?? ""));
  const retParsed = parseTime(String(body.returnTime ?? ""));
  if (!depParsed) return NextResponse.json({ error: "departureTime must be HH:MM" }, { status: 400 });
  if (!retParsed) return NextResponse.json({ error: "returnTime must be HH:MM" }, { status: 400 });

  const capacity = Number(body.capacity);
  if (!Number.isInteger(capacity) || capacity < 1)
    return NextResponse.json({ error: "capacity must be a positive integer" }, { status: 400 });

  const [product] = await db
    .select({ id: products.id, vesselId: products.vesselId })
    .from(products)
    .where(and(eq(products.id, productId), eq(products.operatorId, session.operatorId)));

  if (!product) return NextResponse.json({ error: "Product not found" }, { status: 404 });

  const departureTime = toTimeString(depParsed.hours, depParsed.minutes);
  const returnTime = toTimeString(retParsed.hours, retParsed.minutes);
  const overnight = isOvernight(depParsed, retParsed);
  const retDate = tripEndDate(departureDate, returnTime, overnight);

  const [trip] = await db
    .insert(trips)
    .values({
      operatorId: session.operatorId,
      scheduleId: null,
      productId,
      vesselId: product.vesselId,
      departureDate,
      startTime: new Date(`${departureDate}T${departureTime}Z`),
      endTime: new Date(`${retDate}T${returnTime}Z`),
      capacity,
      seatsRemaining: capacity,
    })
    .returning();

  return NextResponse.json(trip, { status: 201 });
}
