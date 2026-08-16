import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { fishingReports, trips, vessels, products, operators } from "@openboat/db";
import { and, desc, eq, lte } from "drizzle-orm";

const PAGE_SIZE = 20;

export async function GET(req: NextRequest) {
  const [operator] = await db.select().from(operators).limit(1);
  if (!operator) {
    return NextResponse.json({ error: "No operator configured" }, { status: 500 });
  }

  const cursor = req.nextUrl.searchParams.get("cursor"); // createdAt ISO string for pagination
  const vesselId = req.nextUrl.searchParams.get("vesselId");

  const rows = await db
    .select({
      id: fishingReports.id,
      tripId: fishingReports.tripId,
      catchSummary: fishingReports.catchSummary,
      fishCounts: fishingReports.fishCounts,
      photoUrls: fishingReports.photoUrls,
      createdAt: fishingReports.createdAt,
      departureDate: trips.departureDate,
      startTime: trips.startTime,
      vesselId: vessels.id,
      vesselName: vessels.name,
      vesselColor: vessels.color,
      productCategory: products.category,
      productName: products.displayName,
    })
    .from(fishingReports)
    .innerJoin(trips, eq(fishingReports.tripId, trips.id))
    .innerJoin(vessels, eq(fishingReports.vesselId, vessels.id))
    .innerJoin(products, eq(trips.productId, products.id))
    .where(
      and(
        eq(fishingReports.operatorId, operator.id),
        cursor ? lte(fishingReports.createdAt, new Date(cursor)) : undefined,
        vesselId ? eq(fishingReports.vesselId, vesselId) : undefined,
      ),
    )
    .orderBy(desc(fishingReports.createdAt))
    .limit(PAGE_SIZE + 1);

  const hasMore = rows.length > PAGE_SIZE;
  const items = hasMore ? rows.slice(0, PAGE_SIZE) : rows;
  const nextCursor = hasMore ? items[items.length - 1].createdAt.toISOString() : null;

  return NextResponse.json({ items, nextCursor });
}
