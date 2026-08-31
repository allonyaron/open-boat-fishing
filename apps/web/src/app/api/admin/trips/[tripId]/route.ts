import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/session";
import { trips, vessels, products, bookingItems, bookings, tickets, checkIns } from "@openboat/db";
import { and, eq, inArray, sql } from "drizzle-orm";

export async function GET(req: NextRequest, { params }: { params: { tripId: string } }) {
  const auth = await requireAdmin(req);
  if (auth instanceof NextResponse) return auth;
  const { session } = auth;

  const { tripId } = params;

  const [trip] = await db
    .select({
      id: trips.id,
      departureDate: trips.departureDate,
      startTime: trips.startTime,
      endTime: trips.endTime,
      boardingTime: trips.boardingTime,
      capacity: trips.capacity,
      seatsRemaining: trips.seatsRemaining,
      status: trips.status,
      cancellationReason: trips.cancellationReason,
      cancelledAt: trips.cancelledAt,
      vessel: { id: vessels.id, name: vessels.name, color: vessels.color },
      product: { id: products.id, displayName: products.displayName, category: products.category },
    })
    .from(trips)
    .innerJoin(vessels, eq(trips.vesselId, vessels.id))
    .innerJoin(products, eq(trips.productId, products.id))
    .where(and(eq(trips.id, tripId), eq(trips.operatorId, session.operatorId)));

  if (!trip) {
    return NextResponse.json({ error: "Trip not found" }, { status: 404 });
  }

  const itemRows = await db.select().from(bookingItems).where(eq(bookingItems.tripId, tripId));

  if (itemRows.length === 0) {
    return NextResponse.json({ trip, bookings: [] });
  }

  const bookingIds = [...new Set(itemRows.map((i) => i.bookingId))];

  const [bookingRows, ticketRows, checkInRows] = await Promise.all([
    db.select().from(bookings).where(inArray(bookings.id, bookingIds)),
    db
      .select()
      .from(tickets)
      .where(
        inArray(
          tickets.bookingItemId,
          itemRows.map((i) => i.id),
        ),
      ),
    db.select().from(checkIns).where(eq(checkIns.tripId, tripId)),
  ]);

  const checkInByTicket = new Map(checkInRows.map((c) => [c.ticketId, c]));

  const bookingList = bookingRows.map((b) => {
    const items = itemRows.filter((i) => i.bookingId === b.id);
    const ticketList = ticketRows
      .filter((t) => items.some((i) => i.id === t.bookingItemId))
      .map((t) => ({
        id: t.id,
        ticketType: t.ticketType,
        priceCents: t.priceCents,
        feeAmountCents: t.feeAmountCents,
        feeStatus: t.feeStatus,
        voided: t.voided,
        passengerName: t.passengerName,
        checkedIn: checkInByTicket.has(t.id),
        checkedInAt: checkInByTicket.get(t.id)?.checkedInAt ?? null,
      }));

    return {
      id: b.id,
      confirmationCode: b.confirmationCode,
      customerName: b.customerName,
      customerEmail: b.customerEmail,
      customerPhone: b.customerPhone,
      status: b.status,
      totalCents: b.totalCents,
      stripePaymentIntentId: b.stripePaymentIntentId,
      createdAt: b.createdAt,
      tickets: ticketList,
    };
  });

  return NextResponse.json({ trip, bookings: bookingList });
}

export async function PATCH(req: NextRequest, { params }: { params: { tripId: string } }) {
  const auth = await requireAdmin(req);
  if (auth instanceof NextResponse) return auth;
  const { session } = auth;

  const { tripId } = params;
  const body = (await req.json().catch(() => ({}))) as { capacity?: unknown };

  const newCapacity = Number(body.capacity);
  if (!Number.isInteger(newCapacity) || newCapacity < 1) {
    return NextResponse.json({ error: "capacity must be a positive integer" }, { status: 400 });
  }

  let result = {} as { capacity: number; seatsRemaining: number; sold: number };

  try {
    await db.transaction(async (tx) => {
      const [trip] = await tx
        .select({ id: trips.id, capacity: trips.capacity, status: trips.status })
        .from(trips)
        .where(and(eq(trips.id, tripId), eq(trips.operatorId, session.operatorId)))
        .for("update");

      if (!trip) throw Object.assign(new Error("Trip not found"), { status: 404 });
      if (trip.status === "cancelled")
        throw Object.assign(new Error("Cannot edit a cancelled trip"), { status: 409 });

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

      result = { capacity: newCapacity, seatsRemaining: updated.seatsRemaining, sold };
    });
  } catch (err: unknown) {
    const e = err as { message?: string; status?: number };
    if (e.status) return NextResponse.json({ error: e.message }, { status: e.status });
    throw err;
  }

  return NextResponse.json({ ok: true, ...result });
}
