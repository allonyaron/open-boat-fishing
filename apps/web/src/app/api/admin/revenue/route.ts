import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/session";
import { settleTrips } from "@/lib/settle-trips";
import { trips, vessels, products, bookingItems, tickets } from "@openboat/db";
import { and, eq, gte, lte, sql } from "drizzle-orm";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const auth = await requireAdmin(req);
  if (auth instanceof NextResponse) return auth;
  const { session } = auth;

  // Run lazy settlement before any fee reads
  await settleTrips(session.operatorId);

  const { searchParams } = new URL(req.url);
  // Default: last 90 days
  const toDate = searchParams.get("to") ?? new Date().toISOString().slice(0, 10);
  const fromDate =
    searchParams.get("from") ??
    new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  // Per-trip fee summary: earned / held / reversed counts and cents
  const tripRows = await db
    .select({
      tripId: trips.id,
      departureDate: trips.departureDate,
      startTime: trips.startTime,
      status: trips.status,
      vesselName: vessels.name,
      vesselColor: vessels.color,
      productName: products.displayName,
      earnedCount: sql<number>`cast(sum(case when ${tickets.feeStatus} = 'earned' and not ${tickets.voided} then 1 else 0 end) as int)`,
      heldCount: sql<number>`cast(sum(case when ${tickets.feeStatus} = 'held'   and not ${tickets.voided} then 1 else 0 end) as int)`,
      reversedCount: sql<number>`cast(sum(case when ${tickets.feeStatus} = 'reversed' then 1 else 0 end) as int)`,
      earnedCents: sql<number>`cast(sum(case when ${tickets.feeStatus} = 'earned' and not ${tickets.voided} then ${tickets.feeAmountCents} else 0 end) as int)`,
      heldCents: sql<number>`cast(sum(case when ${tickets.feeStatus} = 'held'   and not ${tickets.voided} then ${tickets.feeAmountCents} else 0 end) as int)`,
      reversedCents: sql<number>`cast(sum(case when ${tickets.feeStatus} = 'reversed' then ${tickets.feeAmountCents} else 0 end) as int)`,
    })
    .from(trips)
    .innerJoin(vessels, eq(trips.vesselId, vessels.id))
    .innerJoin(products, eq(trips.productId, products.id))
    .innerJoin(bookingItems, eq(bookingItems.tripId, trips.id))
    .innerJoin(tickets, eq(tickets.bookingItemId, bookingItems.id))
    .where(
      and(
        eq(trips.operatorId, session.operatorId),
        gte(trips.departureDate, fromDate),
        lte(trips.departureDate, toDate),
      ),
    )
    .groupBy(trips.id, vessels.name, vessels.color, products.displayName)
    .orderBy(trips.startTime);

  const totals = tripRows.reduce(
    (acc, r) => ({
      earnedCents: acc.earnedCents + Number(r.earnedCents),
      heldCents: acc.heldCents + Number(r.heldCents),
      reversedCents: acc.reversedCents + Number(r.reversedCents),
      earnedCount: acc.earnedCount + Number(r.earnedCount),
      heldCount: acc.heldCount + Number(r.heldCount),
      reversedCount: acc.reversedCount + Number(r.reversedCount),
    }),
    {
      earnedCents: 0,
      heldCents: 0,
      reversedCents: 0,
      earnedCount: 0,
      heldCount: 0,
      reversedCount: 0,
    },
  );

  return NextResponse.json({ fromDate, toDate, totals, trips: tripRows });
}
