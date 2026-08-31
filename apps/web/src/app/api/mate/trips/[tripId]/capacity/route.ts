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

  let responseData: {
    capacity: number;
    seatsRemaining: number;
    certificateCapacity: number | null;
    ticketsSold: number;
  } | null = null;

  try {
    await db.transaction(async (tx) => {
      const [trip] = await tx
        .select({
          id: trips.id,
          capacity: trips.capacity,
          status: trips.status,
          certificateCapacity: vessels.certificateCapacity,
        })
        .from(trips)
        .innerJoin(vessels, eq(trips.vesselId, vessels.id))
        .where(and(eq(trips.id, tripId), eq(trips.operatorId, staff.operatorId)))
        .for("update");

      if (!trip) throw Object.assign(new Error("Trip not found"), { status: 404 });
      if (trip.status === "cancelled")
        throw Object.assign(new Error("Cannot edit a cancelled trip"), { status: 409 });
      if (trip.certificateCapacity === null)
        throw Object.assign(
          new Error("Certificate capacity not configured for this vessel — contact admin"),
          { status: 422 },
        );
      if (newCapacity > trip.certificateCapacity)
        throw Object.assign(
          new Error(`Cannot exceed certificate capacity of ${trip.certificateCapacity}`),
          { status: 422 },
        );

      const [{ sold }] = await tx
        .select({ sold: sql<number>`cast(count(*) as int)` })
        .from(tickets)
        .innerJoin(bookingItems, eq(tickets.bookingItemId, bookingItems.id))
        .where(and(eq(bookingItems.tripId, tripId), eq(tickets.voided, false)));

      if (newCapacity < sold)
        throw Object.assign(
          new Error(`Cannot set capacity below tickets already sold (${sold})`),
          { status: 422 },
        );

      const [updated] = await tx
        .update(trips)
        .set({
          capacity: newCapacity,
          seatsRemaining: sql<number>`GREATEST(0, ${trips.seatsRemaining} + ${newCapacity - trip.capacity})`,
          updatedAt: new Date(),
        })
        .where(eq(trips.id, tripId))
        .returning({ seatsRemaining: trips.seatsRemaining });

      await tx.insert(capacityChanges).values({
        tripId,
        operatorId: staff.operatorId,
        staffId: staff.staffId,
        previousCapacity: trip.capacity,
        newCapacity,
      });

      responseData = {
        capacity: newCapacity,
        seatsRemaining: updated.seatsRemaining,
        certificateCapacity: trip.certificateCapacity,
        ticketsSold: sold,
      };
    });
  } catch (err: unknown) {
    const e = err as { message?: string; status?: number };
    if (e.status) return NextResponse.json({ error: e.message }, { status: e.status });
    throw err;
  }

  // TODO: fire standby notifications when capacity increases (item 26)

  return NextResponse.json(responseData!);
}
