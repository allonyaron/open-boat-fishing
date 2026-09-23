import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/session";
import { tickets, bookingItems, checkIns } from "@openboat/db";
import { and, eq } from "drizzle-orm";

// Admin/office-side check-in toggle — parallel to /api/mate/checkins but
// single-ticket and synchronous (no offline queue). Backs the passenger
// list's "Aboard" / "Undo" buttons.
export async function POST(req: NextRequest, { params }: { params: { tripId: string } }) {
  const auth = await requireAdmin(req);
  if (auth instanceof NextResponse) return auth;
  const { session } = auth;

  const { tripId } = params;
  const body = (await req.json().catch(() => ({}))) as {
    ticketId?: unknown;
    checkedIn?: unknown;
  };

  const ticketId = String(body.ticketId ?? "");
  if (!ticketId) {
    return NextResponse.json({ error: "ticketId is required" }, { status: 400 });
  }
  if (typeof body.checkedIn !== "boolean") {
    return NextResponse.json({ error: "checkedIn must be a boolean" }, { status: 400 });
  }

  const [ticket] = await db
    .select({ id: tickets.id, voided: tickets.voided, operatorId: tickets.operatorId })
    .from(tickets)
    .innerJoin(bookingItems, eq(tickets.bookingItemId, bookingItems.id))
    .where(
      and(
        eq(tickets.id, ticketId),
        eq(bookingItems.tripId, tripId),
        eq(tickets.operatorId, session.operatorId),
      ),
    );

  if (!ticket) {
    return NextResponse.json({ error: "Ticket not found on this trip" }, { status: 404 });
  }

  if (body.checkedIn) {
    if (ticket.voided) {
      return NextResponse.json({ error: "Cannot check in a refunded ticket" }, { status: 409 });
    }
    let [row] = await db
      .insert(checkIns)
      .values({
        ticketId,
        tripId,
        operatorId: session.operatorId,
        staffId: session.staffId,
        method: "manual",
      })
      .onConflictDoNothing({ target: checkIns.ticketId })
      .returning({ checkedInAt: checkIns.checkedInAt });

    if (!row) {
      // Already checked in (e.g. by the mate app) — idempotent, return the existing timestamp.
      [row] = await db
        .select({ checkedInAt: checkIns.checkedInAt })
        .from(checkIns)
        .where(eq(checkIns.ticketId, ticketId));
    }

    return NextResponse.json({ ok: true, checkedIn: true, checkedInAt: row.checkedInAt });
  }

  await db.delete(checkIns).where(eq(checkIns.ticketId, ticketId));
  return NextResponse.json({ ok: true, checkedIn: false, checkedInAt: null });
}
