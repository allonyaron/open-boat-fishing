import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/session";
import { fishingReports, trips } from "@openboat/db";
import { and, eq } from "drizzle-orm";

type FishCount = { species: string; count: number };

function parseBody(
  raw: unknown,
): { catchSummary?: string; fishCounts?: FishCount[]; photoUrls?: string[] } | string {
  if (typeof raw !== "object" || raw === null) return "body must be an object";
  const b = raw as Record<string, unknown>;
  if (
    b.catchSummary !== undefined &&
    (typeof b.catchSummary !== "string" || b.catchSummary.length > 2000)
  ) {
    return "catchSummary must be a string ≤ 2000 chars";
  }
  if (b.fishCounts !== undefined) {
    if (!Array.isArray(b.fishCounts) || b.fishCounts.length > 50)
      return "fishCounts must be an array ≤ 50 items";
    for (const item of b.fishCounts) {
      if (typeof item !== "object" || item === null) return "each fishCount must be an object";
      const fc = item as Record<string, unknown>;
      if (typeof fc.species !== "string" || fc.species.length < 1 || fc.species.length > 100)
        return "species must be a string 1–100 chars";
      if (typeof fc.count !== "number" || !Number.isInteger(fc.count) || fc.count < 0)
        return "count must be a non-negative integer";
    }
  }
  if (b.photoUrls !== undefined) {
    if (!Array.isArray(b.photoUrls) || b.photoUrls.length > 20)
      return "photoUrls must be an array ≤ 20 items";
    for (const u of b.photoUrls) {
      if (typeof u !== "string" || u.length > 2048)
        return "each photoUrl must be a string ≤ 2048 chars";
    }
  }
  return {
    catchSummary: b.catchSummary as string | undefined,
    fishCounts: b.fishCounts as FishCount[] | undefined,
    photoUrls: b.photoUrls as string[] | undefined,
  };
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ tripId: string }> }) {
  const auth = await requireAdmin(req);
  if (auth instanceof NextResponse) return auth;
  const { session } = auth;

  const { tripId } = await params;

  const [report] = await db
    .select()
    .from(fishingReports)
    .where(
      and(eq(fishingReports.tripId, tripId), eq(fishingReports.operatorId, session.operatorId)),
    );

  if (!report) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.json(report);
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ tripId: string }> }) {
  const auth = await requireAdmin(req);
  if (auth instanceof NextResponse) return auth;
  const { session } = auth;

  const { tripId } = await params;

  const body = parseBody(await req.json().catch(() => ({})));
  if (typeof body === "string") {
    return NextResponse.json({ error: body }, { status: 400 });
  }
  const { catchSummary, fishCounts, photoUrls } = body;

  const [trip] = await db
    .select({ id: trips.id, vesselId: trips.vesselId, status: trips.status })
    .from(trips)
    .where(and(eq(trips.id, tripId), eq(trips.operatorId, session.operatorId)));

  if (!trip) {
    return NextResponse.json({ error: "Trip not found" }, { status: 404 });
  }
  if (trip.status !== "sailed" && trip.status !== "pending_settlement") {
    return NextResponse.json(
      { error: "Reports can only be posted after the trip has sailed" },
      { status: 409 },
    );
  }

  const [report] = await db
    .insert(fishingReports)
    .values({
      operatorId: session.operatorId,
      tripId,
      vesselId: trip.vesselId,
      staffId: session.staffId,
      catchSummary: catchSummary ?? null,
      fishCounts: fishCounts ?? [],
      photoUrls: photoUrls ?? [],
    })
    .onConflictDoUpdate({
      target: fishingReports.tripId,
      set: {
        catchSummary: catchSummary ?? null,
        fishCounts: fishCounts ?? [],
        photoUrls: photoUrls ?? [],
        staffId: session.staffId,
        updatedAt: new Date(),
      },
    })
    .returning();

  return NextResponse.json(report, { status: 201 });
}
