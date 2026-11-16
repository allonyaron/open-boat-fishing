import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/session";
import { trips, vessels, products, bookingItems, bookings, tickets, checkIns } from "@openboat/db";
import { and, eq, inArray, ne, sql } from "drizzle-orm";
import type { PgUpdateSetSource } from "drizzle-orm/pg-core";
import { liveTicketCount, seatHoldingTicketCount } from "@/lib/tickets/queries";
import { isTicketLive, type TicketStatus } from "@/lib/tickets/status";

/**
 * The part of a booking item's charged subtotal that pays for its live
 * tickets. The subtotal is net of any group discount; it's split across the
 * tickets that were paid for (live, refunded, disputed) in proportion to their
 * list prices, so a refunded or disputed ticket's share drops out. Unpaid
 * holds count for nothing.
 */
function paidForLiveTickets(
  subtotalCents: number,
  itemTickets: { priceCents: number; status: TicketStatus; voided: boolean }[],
): number {
  const paid = itemTickets.filter((t) => t.status !== "held" && t.status !== "voided");
  const listTotal = paid.reduce((s, t) => s + t.priceCents, 0);
  if (listTotal === 0) return 0;
  const liveList = paid.filter(isTicketLive).reduce((s, t) => s + t.priceCents, 0);
  return Math.round((subtotalCents * liveList) / listTotal);
}

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
      onlineCutoffMinutes: trips.onlineCutoffMinutes,
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

  const itemRows = await db
    .select()
    .from(bookingItems)
    .where(and(eq(bookingItems.tripId, tripId), eq(bookingItems.operatorId, session.operatorId)));

  if (itemRows.length === 0) {
    return NextResponse.json({ trip, bookings: [] });
  }

  const bookingIds = [...new Set(itemRows.map((i) => i.bookingId))];

  const [bookingRows, ticketRows, checkInRows] = await Promise.all([
    db
      .select()
      .from(bookings)
      .where(and(inArray(bookings.id, bookingIds), eq(bookings.operatorId, session.operatorId))),
    // Every ticket but the never-paid voided ones (expired or released holds):
    // those were never passengers. Unpaid holds (held) are listed as awaiting payment.
    db
      .select()
      .from(tickets)
      .where(
        and(
          inArray(
            tickets.bookingItemId,
            itemRows.map((i) => i.id),
          ),
          eq(tickets.operatorId, session.operatorId),
          ne(tickets.status, "voided"),
        ),
      ),
    db
      .select()
      .from(checkIns)
      .where(and(eq(checkIns.tripId, tripId), eq(checkIns.operatorId, session.operatorId))),
  ]);

  const checkInByTicket = new Map(checkInRows.map((c) => [c.ticketId, c]));

  const bookingList = bookingRows
    .map((b) => {
      const items = itemRows.filter((i) => i.bookingId === b.id);
      const bookingTickets = ticketRows.filter((t) => items.some((i) => i.id === t.bookingItemId));
      const ticketList = bookingTickets.map((t) => ({
        id: t.id,
        ticketType: t.ticketType,
        priceCents: t.priceCents,
        feeAmountCents: t.feeAmountCents,
        feeStatus: t.feeStatus,
        status: t.status,
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
        notes: b.notes,
        status: b.status,
        totalCents: b.totalCents,
        paidCents: items.reduce((s, i) => s + paidForLiveTickets(i.subtotalCents, bookingTickets.filter((t) => t.bookingItemId === i.id)), 0),
        stripePaymentIntentId: b.stripePaymentIntentId,
        createdAt: b.createdAt,
        tickets: ticketList,
      };
    })
    .filter((b) => b.tickets.length > 0);

  return NextResponse.json({ trip, bookings: bookingList });
}

export async function PATCH(req: NextRequest, { params }: { params: { tripId: string } }) {
  const auth = await requireAdmin(req);
  if (auth instanceof NextResponse) return auth;
  const { session } = auth;

  const { tripId } = params;
  const body = (await req.json().catch(() => ({}))) as {
    capacity?: unknown;
    onlineCutoffMinutes?: unknown;
  };

  // Either field may be sent alone. onlineCutoffMinutes: null clears the
  // override so the trip follows the operator default again.
  const hasCapacity = "capacity" in body;
  const hasCutoff = "onlineCutoffMinutes" in body;
  if (!hasCapacity && !hasCutoff) {
    return NextResponse.json({ error: "capacity or onlineCutoffMinutes is required" }, { status: 400 });
  }

  const newCapacity = Number(body.capacity);
  if (hasCapacity && (!Number.isInteger(newCapacity) || newCapacity < 1)) {
    return NextResponse.json({ error: "capacity must be a positive integer" }, { status: 400 });
  }

  let newCutoff: number | null = null;
  if (hasCutoff && body.onlineCutoffMinutes !== null) {
    newCutoff = Number(body.onlineCutoffMinutes);
    if (body.onlineCutoffMinutes === "" || !Number.isInteger(newCutoff) || newCutoff < 0) {
      return NextResponse.json(
        { error: "onlineCutoffMinutes must be a non-negative integer or null" },
        { status: 400 },
      );
    }
  }

  let result = {} as {
    capacity: number;
    seatsRemaining: number;
    sold?: number;
    onlineCutoffMinutes: number | null;
  };

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

      const set: PgUpdateSetSource<typeof trips> = { updatedAt: new Date() };
      let sold: number | undefined;

      if (hasCapacity) {
        // The floor counts every seat taken, unpaid holds included; `sold` in
        // the response counts paid tickets only.
        let taken: number;
        [{ sold, taken }] = await tx
          .select({ sold: liveTicketCount(trips.id), taken: seatHoldingTicketCount(trips.id) })
          .from(trips)
          .where(and(eq(trips.id, tripId), eq(trips.operatorId, session.operatorId)));

        if (newCapacity < taken)
          throw Object.assign(
            new Error(
              taken > sold
                ? `Cannot set capacity below seats already taken (${taken}, including ${taken - sold} awaiting payment)`
                : `Cannot set capacity below tickets already sold (${sold})`,
            ),
            { status: 422 },
          );

        set.capacity = newCapacity;
        set.seatsRemaining = sql<number>`GREATEST(0, ${trips.seatsRemaining} + ${newCapacity - trip.capacity})`;
      }
      if (hasCutoff) set.onlineCutoffMinutes = newCutoff;

      const [updated] = await tx
        .update(trips)
        .set(set)
        .where(and(eq(trips.id, tripId), eq(trips.operatorId, session.operatorId)))
        .returning({
          capacity: trips.capacity,
          seatsRemaining: trips.seatsRemaining,
          onlineCutoffMinutes: trips.onlineCutoffMinutes,
        });

      result = { ...updated, sold };
    });
  } catch (err: unknown) {
    const e = err as { message?: string; status?: number };
    if (e.status) return NextResponse.json({ error: e.message }, { status: e.status });
    throw err;
  }

  return NextResponse.json({ ok: true, ...result });
}
