import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/session";
import { settleTrips } from "@/lib/settle-trips";
import { todayET, addDaysToDateString } from "@/lib/date-et";
import { trips, vessels, products, bookingItems, tickets, fishingReports } from "@openboat/db";
import { and, eq, gte, inArray, isNull, sql } from "drizzle-orm";

export const dynamic = "force-dynamic";

// Mirrors the reports-owed criteria in /api/admin/today: sailed or
// pending_settlement trips in the last 5 days with no fishing_reports row.
const LOOKBACK_DAYS = 5;

export async function GET(req: NextRequest) {
  const auth = await requireAdmin(req);
  if (auth instanceof NextResponse) return auth;
  const { session } = auth;
  const operatorId = session.operatorId;

  await settleTrips(operatorId);

  const rows = await db
    .select({
      id: trips.id,
      departureDate: trips.departureDate,
      startTime: trips.startTime,
      endTime: trips.endTime,
      vessel: { name: vessels.name, color: vessels.color },
      product: { displayName: products.displayName },
      ticketsSold: sql<number>`(
        select cast(count(*) as int) from ${tickets} t
        join ${bookingItems} bi on bi.id = t.booking_item_id
        where bi.trip_id = trips.id
          and t.voided = false
      )`.as("tickets_sold"),
    })
    .from(trips)
    .innerJoin(vessels, eq(trips.vesselId, vessels.id))
    .innerJoin(products, eq(trips.productId, products.id))
    .leftJoin(fishingReports, eq(fishingReports.tripId, trips.id))
    .where(
      and(
        eq(trips.operatorId, operatorId),
        inArray(trips.status, ["sailed", "pending_settlement"]),
        gte(trips.departureDate, addDaysToDateString(todayET(), -LOOKBACK_DAYS)),
        isNull(fishingReports.id),
      ),
    )
    .orderBy(trips.departureDate);

  return NextResponse.json(rows);
}
