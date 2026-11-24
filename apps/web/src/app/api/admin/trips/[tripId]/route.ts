import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/session";
import { recordAudit } from "@/lib/audit";
import { trips, vessels, products, bookingItems, bookings, tickets, checkIns, disputes } from "@openboat/db";
import { and, desc, eq, inArray, ne } from "drizzle-orm";
import { chargebackState } from "@/lib/disputes/list";
import type { PgUpdateSetSource } from "drizzle-orm/pg-core";
import { isTicketLive, type TicketStatus } from "@/lib/tickets/status";
import { InventoryError, setTripCapacity } from "@/lib/inventory/seats";

/**
 * What a booking's live tickets paid: each ticket's priceCents is its share
 * of the charge, net of any group discount, so a refunded or disputed
 * ticket's share drops out and unpaid holds count for nothing.
 */
function paidForLiveTickets(
  itemTickets: { priceCents: number; status: TicketStatus; voided: boolean }[],
): number {
  return itemTickets.filter(isTicketLive).reduce((s, t) => s + t.priceCents, 0);
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

  const [bookingRows, ticketRows, checkInRows, disputeRows] = await Promise.all([
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
    // Newest first, so the first one seen per booking is its latest.
    db
      .select({ bookingId: disputes.bookingId, status: disputes.status })
      .from(disputes)
      .where(and(inArray(disputes.bookingId, bookingIds), eq(disputes.operatorId, session.operatorId)))
      .orderBy(desc(disputes.openedAt)),
  ]);

  const chargebackOf = new Map<string, ReturnType<typeof chargebackState>>();
  for (const d of disputeRows) {
    if (d.bookingId && !chargebackOf.has(d.bookingId)) chargebackOf.set(d.bookingId, chargebackState(d.status));
  }

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
        paidCents: paidForLiveTickets(bookingTickets),
        chargeback: chargebackOf.get(b.id) ?? null,
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
  const { session, ctx } = auth;

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
        .select({ id: trips.id, status: trips.status, onlineCutoffMinutes: trips.onlineCutoffMinutes })
        .from(trips)
        .where(and(eq(trips.id, tripId), eq(trips.operatorId, session.operatorId)))
        .for("update");

      if (!trip) throw Object.assign(new Error("Trip not found"), { status: 404 });
      if (trip.status === "cancelled")
        throw Object.assign(new Error("Cannot edit a cancelled trip"), { status: 409 });

      let sold: number | undefined;
      if (hasCapacity) {
        // The inventory module enforces the vessel's certificate capacity
        // when it has one, and the floor of seats already taken (P7-3).
        ({ sold } = await setTripCapacity(tx, ctx, {
          operatorId: session.operatorId,
          tripId,
          capacity: newCapacity,
        }));
      }

      const set: PgUpdateSetSource<typeof trips> = { updatedAt: new Date() };
      if (hasCutoff) set.onlineCutoffMinutes = newCutoff;
      if (hasCutoff && trip.onlineCutoffMinutes !== newCutoff) {
        await recordAudit(tx, ctx, {
          operatorId: session.operatorId,
          action: "trip.update",
          targetTable: "trips",
          targetId: tripId,
          before: { onlineCutoffMinutes: trip.onlineCutoffMinutes },
          after: { onlineCutoffMinutes: newCutoff },
        });
      }

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
    if (err instanceof InventoryError) {
      return NextResponse.json({ error: err.message }, { status: err.httpStatus });
    }
    const e = err as { message?: string; status?: number };
    if (e.status) return NextResponse.json({ error: e.message }, { status: e.status });
    throw err;
  }

  return NextResponse.json({ ok: true, ...result });
}
