import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { fishingReports, trips, vessels, products } from "@openboat/db";
import { and, eq } from "drizzle-orm";
import { getOperatorId } from "@/lib/operator";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ reportId: string }> },
) {
  const operatorId = getOperatorId(req);
  if (!operatorId) {
    return NextResponse.json({ error: "No operator configured" }, { status: 500 });
  }

  const { reportId } = await params;

  const [row] = await db
    .select({
      id: fishingReports.id,
      tripId: fishingReports.tripId,
      catchSummary: fishingReports.catchSummary,
      fishCounts: fishingReports.fishCounts,
      photoUrls: fishingReports.photoUrls,
      createdAt: fishingReports.createdAt,
      updatedAt: fishingReports.updatedAt,
      departureDate: trips.departureDate,
      startTime: trips.startTime,
      endTime: trips.endTime,
      vesselId: vessels.id,
      vesselName: vessels.name,
      vesselColor: vessels.color,
      vesselSlug: vessels.slug,
      productCategory: products.category,
      productName: products.displayName,
    })
    .from(fishingReports)
    .innerJoin(trips, eq(fishingReports.tripId, trips.id))
    .innerJoin(vessels, eq(fishingReports.vesselId, vessels.id))
    .innerJoin(products, eq(trips.productId, products.id))
    .where(and(eq(fishingReports.id, reportId), eq(fishingReports.operatorId, operatorId)));

  if (!row) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.json(row);
}
