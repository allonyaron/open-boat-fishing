import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/session";
import { settleTrips } from "@/lib/settle-trips";
import { todayET, addDaysToDateString, etMidnightUTC } from "@/lib/date-et";
import {
  trips,
  vessels,
  products,
  bookingItems,
  tickets,
  bookings,
  schedules,
  fishingReports,
} from "@openboat/db";
import { and, eq, gte, lt, lte, sql, isNull, inArray } from "drizzle-orm";

export const dynamic = "force-dynamic";

// A schedule's last day is worth surfacing once it's close enough to matter —
// far in the future it's just noise. 45 days gives an operator a real runway
// to extend the pattern before customers start hitting a dead calendar.
const SEASON_END_WARNING_DAYS = 45;
// Reports only get chased for trips that sailed recently — a report on a
// month-old trip isn't actionable in the same way.
const REPORTS_OWED_LOOKBACK_DAYS = 5;

export async function GET(req: NextRequest) {
  const auth = await requireAdmin(req);
  if (auth instanceof NextResponse) return auth;
  const { session } = auth;
  const operatorId = session.operatorId;

  await settleTrips(operatorId);

  const today = todayET();
  const windowEnd = addDaysToDateString(today, 3);

  const tripRows = await db
    .select({
      id: trips.id,
      departureDate: trips.departureDate,
      scheduleId: trips.scheduleId,
      startTime: trips.startTime,
      endTime: trips.endTime,
      capacity: trips.capacity,
      status: trips.status,
      vessel: { name: vessels.name, color: vessels.color },
      product: { displayName: products.displayName },
      ticketsSold: sql<number>`(
        select cast(count(*) as int) from ${tickets} t
        join ${bookingItems} bi on bi.id = t.booking_item_id
        where bi.trip_id = trips.id
          and t.voided = false
      )`.as("tickets_sold"),
      refundedCount: sql<number>`(
        select cast(count(*) as int) from ${tickets} t
        join ${bookingItems} bi on bi.id = t.booking_item_id
        where bi.trip_id = trips.id
          and t.voided = true
      )`.as("refunded_count"),
    })
    .from(trips)
    .innerJoin(vessels, eq(trips.vesselId, vessels.id))
    .innerJoin(products, eq(trips.productId, products.id))
    .where(
      and(
        eq(trips.operatorId, operatorId),
        gte(trips.departureDate, today),
        lte(trips.departureDate, windowEnd),
      ),
    )
    .orderBy(trips.startTime);

  const todayTrips = tripRows.filter((t) => t.departureDate === today);
  const liveToday = todayTrips.filter((t) => t.status !== "cancelled");

  const stats = {
    tripsGoingOut: liveToday.length,
    peopleBooked: liveToday.reduce((sum, t) => sum + t.ticketsSold, 0),
    seatsForSale: liveToday.reduce((sum, t) => sum + Math.max(0, t.capacity - t.ticketsSold), 0),
    takenInTodayCents: 0,
  };

  const todayStartUTC = etMidnightUTC(today);
  const todayEndUTC = etMidnightUTC(addDaysToDateString(today, 1));
  const [takenRow] = await db
    .select({ totalCents: sql<number>`cast(coalesce(sum(${bookings.totalCents}), 0) as int)` })
    .from(bookings)
    .where(
      and(
        eq(bookings.operatorId, operatorId),
        eq(bookings.status, "confirmed"),
        gte(bookings.createdAt, todayStartUTC),
        lt(bookings.createdAt, todayEndUTC),
      ),
    );
  stats.takenInTodayCents = takenRow?.totalCents ?? 0;

  // Season end: latest day covered by any active pattern, only surfaced once
  // it's within the warning window.
  const [latestActive] = await db
    .select({ endDate: schedules.endDate })
    .from(schedules)
    .where(and(eq(schedules.operatorId, operatorId), eq(schedules.active, true)))
    .orderBy(sql`${schedules.endDate} desc`)
    .limit(1);

  const seasonEndCutoff = addDaysToDateString(today, SEASON_END_WARNING_DAYS);
  const seasonEnd =
    latestActive && latestActive.endDate <= seasonEndCutoff ? { date: latestActive.endDate } : null;

  // Reports owed: sailed or pending_settlement trips (both are report-eligible
  // per POST .../report) in the lookback window with no fishing_reports row
  // yet — includes a trip that departed earlier today. Oldest first so the
  // alert's CTA opens the one that's been waiting longest.
  const reportsOwedRows = await db
    .select({ tripId: trips.id })
    .from(trips)
    .leftJoin(fishingReports, eq(fishingReports.tripId, trips.id))
    .where(
      and(
        eq(trips.operatorId, operatorId),
        inArray(trips.status, ["sailed", "pending_settlement"]),
        gte(trips.departureDate, addDaysToDateString(today, -REPORTS_OWED_LOOKBACK_DAYS)),
        isNull(fishingReports.id),
      ),
    )
    .orderBy(trips.departureDate);

  const reportsOwed =
    reportsOwedRows.length > 0
      ? { count: reportsOwedRows.length, oldestTripId: reportsOwedRows[0].tripId }
      : null;

  return NextResponse.json({
    trips: tripRows,
    today,
    stats,
    alerts: { seasonEnd, reportsOwed },
  });
}
