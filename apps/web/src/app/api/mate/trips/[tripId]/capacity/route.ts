import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireMate } from "@/lib/mate-auth";
import { trips, vessels, tickets, bookingItems, capacityChanges } from "@openboat/db";
import { and, eq, sql } from "drizzle-orm";

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ tripId: string }> }) {
  const auth = await requireMate(req);
  if (auth instanceof NextResponse) return auth;
  const { staff } = auth;

  const { tripId } = await params;
  const body = (await req.json().catch(() => ({}))) as { capacity?: unknown };

  const newCapacity = Number(body.capacity);
  if (!Number.isInteger(newCapacity) || newCapacity < 1) {
    return NextResponse.json({ error: "capacity must be a positive integer" }, { status: 400 });
  }

  const [trip] = await db
    .select({
      id: trips.id,
      capacity: trips.capacity,
      seatsRemaining: trips.seatsRemaining,
      status: trips.status,
      certificateCapacity: vessels.certificateCapacity,
    })
    .from(trips)
    .innerJoin(vessels, eq(trips.vesselId, vessels.id))
    .where(and(eq(trips.id, tripId), eq(trips.operatorId, staff.operatorId)));

  if (!trip) {
    return NextResponse.json({ error: "Trip not found" }, { status: 404 });
  }
  if (trip.status === "cancelled") {
    return NextResponse.json({ error: "Cannot edit a cancelled trip" }, { status: 409 });
  }
  if (trip.certificateCapacity === null) {
    return NextResponse.json(
      { error: "Certificate capacity not configured for this vessel — contact admin" },
      { status: 422 },
    );
  }
  if (newCapacity > trip.certificateCapacity) {
    return NextResponse.json(
      { error: `Cannot exceed certificate capacity of ${trip.certificateCapacity}` },
      { status: 422 },
    );
  }

  const [{ sold }] = await db
    .select({ sold: sql<number>`cast(count(*) as int)` })
    .from(tickets)
    .innerJoin(bookingItems, eq(tickets.bookingItemId, bookingItems.id))
    .where(and(eq(bookingItems.tripId, tripId), eq(tickets.voided, false)));

  if (newCapacity < sold) {
    return NextResponse.json(
      { error: `Cannot set capacity below tickets already sold (${sold})` },
      { status: 422 },
    );
  }

  const delta = newCapacity - trip.capacity;
  const newSeatsRemaining = Math.max(0, trip.seatsRemaining + delta);

  await db.transaction(async (tx) => {
    await tx
      .update(trips)
      .set({ capacity: newCapacity, seatsRemaining: newSeatsRemaining, updatedAt: new Date() })
      .where(eq(trips.id, tripId));

    await tx.insert(capacityChanges).values({
      tripId,
      operatorId: staff.operatorId,
      staffId: staff.staffId,
      previousCapacity: trip.capacity,
      newCapacity,
    });
  });

  // TODO: fire standby notifications when capacity increases (item 26)

  return NextResponse.json({
    capacity: newCapacity,
    seatsRemaining: newSeatsRemaining,
    certificateCapacity: trip.certificateCapacity,
    ticketsSold: sold,
  });
}
