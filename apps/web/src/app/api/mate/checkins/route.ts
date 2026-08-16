import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireMate } from "@/lib/mate-auth";
import { tickets, checkIns, bookingItems } from "@openboat/db";
import { and, eq } from "drizzle-orm";

type CheckInEvent = {
  localId: string;
  ticketId: string;
  tripId: string;
  method: "qr" | "name_search" | "manual";
  note: string | null;
  checkedInAt: string;
};

export async function POST(req: NextRequest) {
  const auth = await requireMate(req);
  if (auth instanceof NextResponse) return auth;
  const { staff } = auth;

  const body = (await req.json().catch(() => ({}))) as { events?: unknown };
  if (!Array.isArray(body.events) || body.events.length === 0) {
    return NextResponse.json({ results: [] });
  }
  const events = body.events as CheckInEvent[];

  const results: {
    localId: string;
    ok: boolean;
    alreadyCheckedIn?: boolean;
    error?: string;
  }[] = [];

  for (const event of events) {
    const { localId, ticketId, tripId, method, note, checkedInAt } = event;

    if (!localId || !ticketId || !tripId || !method || !checkedInAt) {
      results.push({ localId: localId ?? "", ok: false, error: "invalid_event" });
      continue;
    }

    const [ticket] = await db
      .select({ id: tickets.id, voided: tickets.voided })
      .from(tickets)
      .innerJoin(bookingItems, eq(tickets.bookingItemId, bookingItems.id))
      .where(
        and(
          eq(tickets.id, ticketId),
          eq(bookingItems.tripId, tripId),
          eq(tickets.operatorId, staff.operatorId),
        ),
      );

    if (!ticket) {
      results.push({ localId, ok: false, error: "ticket_not_found" });
      continue;
    }

    if (ticket.voided) {
      results.push({ localId, ok: false, error: "ticket_voided" });
      continue;
    }

    try {
      await db
        .insert(checkIns)
        .values({
          ticketId,
          tripId,
          operatorId: staff.operatorId,
          staffId: staff.staffId,
          method,
          note: note ?? null,
          checkedInAt: new Date(checkedInAt),
          syncedAt: new Date(),
        })
        .onConflictDoNothing();
      results.push({ localId, ok: true });
    } catch {
      results.push({ localId, ok: false, error: "server_error" });
    }
  }

  return NextResponse.json({ results });
}
