import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/session";
import { schedules, trips, products, bookingItems, tickets } from "@openboat/db";
import { and, eq, gte, inArray, sql } from "drizzle-orm";
import {
  type DayOfWeek,
  VALID_DAYS,
  datesInRange,
  parseTime,
  toTimeString,
  isOvernight,
  tripEndDate,
} from "@/lib/trip-materialization";
import { etWallClockToUTC } from "@/lib/date-et";

// Edits a weekly pattern (and, via the `active` flag, pauses/resumes it).
//
// Trips are materialized eagerly at creation time (see POST on the parent
// route), so "pause" can't stop future generation the way the product copy
// implies — there's nothing left to generate. Instead this recomputes the
// pattern's expected date set and diffs it against what's already on the
// calendar for today-forward:
//   - dates newly in the pattern get a trip inserted
//   - dates no longer in the pattern get their trip deleted, but ONLY if
//     nobody has booked it yet — a booked trip is left completely alone and
//     still sails, matching "anything already booked still sails"
//   - a pause is the same diff with an empty expected set (nothing should be
//     on the calendar for this pattern while paused)
// Past trips (departureDate < today) are never touched either way.
export async function PATCH(
  req: NextRequest,
  { params }: { params: { scheduleId: string } },
) {
  const auth = await requireAdmin(req);
  if (auth instanceof NextResponse) return auth;
  const { session } = auth;

  const { scheduleId } = params;
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;

  const [existing] = await db
    .select()
    .from(schedules)
    .where(and(eq(schedules.id, scheduleId), eq(schedules.operatorId, session.operatorId)));

  if (!existing) return NextResponse.json({ error: "Schedule not found" }, { status: 404 });

  // Merge: any field not present in the body keeps its current value.
  const productId = String(body.productId ?? existing.productId).trim();
  const startDate = String(body.startDate ?? existing.startDate).trim();
  const endDate = String(body.endDate ?? existing.endDate).trim();
  const daysOfWeek = (body.daysOfWeek as DayOfWeek[] | undefined) ?? (existing.daysOfWeek as DayOfWeek[]);
  const departureTimeInput = String(body.departureTime ?? existing.departureTime);
  const returnTimeInput = String(body.returnTime ?? existing.returnTime);
  const capacity = body.capacity !== undefined ? Number(body.capacity) : existing.capacity;
  const active = body.active !== undefined ? Boolean(body.active) : existing.active;

  if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate))
    return NextResponse.json({ error: "startDate must be YYYY-MM-DD" }, { status: 400 });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(endDate))
    return NextResponse.json({ error: "endDate must be YYYY-MM-DD" }, { status: 400 });
  if (endDate < startDate)
    return NextResponse.json({ error: "endDate must be on or after startDate" }, { status: 400 });
  if (!Array.isArray(daysOfWeek) || daysOfWeek.length === 0 || !daysOfWeek.every((d) => VALID_DAYS.includes(d)))
    return NextResponse.json({ error: "daysOfWeek must be a non-empty array of day abbreviations" }, { status: 400 });

  const depParsed = parseTime(departureTimeInput);
  const retParsed = parseTime(returnTimeInput);
  if (!depParsed) return NextResponse.json({ error: "departureTime must be HH:MM" }, { status: 400 });
  if (!retParsed) return NextResponse.json({ error: "returnTime must be HH:MM" }, { status: 400 });

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

  const today = new Date().toISOString().slice(0, 10);
  const expectedDates = new Set(
    active ? datesInRange(startDate, endDate, daysOfWeek).filter((d) => d >= today) : [],
  );

  const [updated] = await db
    .update(schedules)
    .set({
      productId,
      startDate,
      endDate,
      daysOfWeek,
      departureTime,
      returnTime,
      capacity,
      active,
      updatedAt: new Date(),
    })
    .where(eq(schedules.id, scheduleId))
    .returning();

  // Every not-yet-departed trip currently on the calendar for this pattern,
  // with how many live tickets it has.
  const currentRows = await db
    .select({
      id: trips.id,
      departureDate: trips.departureDate,
      status: trips.status,
      ticketsSold: sql<number>`(
        select cast(count(*) as int) from ${tickets} t
        join ${bookingItems} bi on bi.id = t.booking_item_id
        where bi.trip_id = trips.id
          and t.voided = false
      )`.as("tickets_sold"),
    })
    .from(trips)
    .where(and(eq(trips.scheduleId, scheduleId), gte(trips.departureDate, today)));

  const coveredDates = new Set(currentRows.map((r) => r.departureDate));

  const toDeleteIds = currentRows
    .filter((r) => r.status === "scheduled" && r.ticketsSold === 0 && !expectedDates.has(r.departureDate))
    .map((r) => r.id);
  const tripsKeptBooked = currentRows.filter(
    (r) => r.status === "scheduled" && r.ticketsSold > 0 && !expectedDates.has(r.departureDate),
  ).length;

  const datesToAdd = [...expectedDates].filter((d) => !coveredDates.has(d));
  const newTripRows = datesToAdd.map((date) => {
    const retDate = tripEndDate(date, returnTime, overnight);
    return {
      operatorId: session.operatorId,
      scheduleId,
      productId,
      vesselId: product.vesselId,
      departureDate: date,
      startTime: etWallClockToUTC(date, departureTime),
      endTime: etWallClockToUTC(retDate, returnTime),
      capacity,
      seatsRemaining: capacity,
    };
  });

  if (toDeleteIds.length > 0) {
    await db.delete(trips).where(inArray(trips.id, toDeleteIds));
  }
  if (newTripRows.length > 0) {
    await db.insert(trips).values(newTripRows).onConflictDoNothing();
  }

  return NextResponse.json({
    ...updated,
    tripsAdded: newTripRows.length,
    tripsRemoved: toDeleteIds.length,
    tripsKeptBooked,
  });
}
