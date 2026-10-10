import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { bookings } from "@openboat/db";
import { and, eq, gt } from "drizzle-orm";
import { z } from "zod";
import { getOperatorId } from "@/lib/operator";
import { checkRateLimit, tooManyRequests } from "@/lib/rate-limit";
import { customerContactSchema } from "@/lib/bookings/contact";
import { requireHoldToken } from "@/lib/bookings/hold-token";

// PATCH /api/bookings/:id/contact — a payment retry reuses the first attempt's
// booking and PI (P2-3), so a name, email or phone fixed after a decline must
// reach the pending booking. The client awaits this before confirming the
// payment: the succeeded webhook emails the address stored here.
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ bookingId: string }> },
) {
  const operatorId = getOperatorId(req);
  if (!operatorId) {
    return NextResponse.json({ error: "No operator configured" }, { status: 500 });
  }

  const { bookingId } = await params;
  if (!z.string().uuid().safeParse(bookingId).success) {
    return NextResponse.json({ error: "Booking not found" }, { status: 404 });
  }
  const denied = requireHoldToken(req, bookingId, operatorId);
  if (denied) return denied;

  // Per booking, not per IP: the token already proves the caller owns this
  // booking, and customers behind one IP (dock wifi, carrier NAT) shouldn't
  // share a budget. A request without a valid token never gets here.
  const rl = await checkRateLimit(`booking-contact:${bookingId}`, 10, 15 * 60 * 1000);
  if (!rl.allowed) return tooManyRequests(rl.retryAfterSec);

  const parsed = customerContactSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request", details: parsed.error.flatten().fieldErrors },
      { status: 400 },
    );
  }
  const { customerName, customerEmail, customerPhone } = parsed.data;

  // Only a live hold can be edited: once it expires, its seats may be reclaimed
  // at any moment, and the client should start a new booking instead.
  const [updated] = await db
    .update(bookings)
    .set({
      customerName: customerName ?? null,
      customerEmail,
      customerPhone: customerPhone ?? null,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(bookings.id, bookingId),
        eq(bookings.operatorId, operatorId),
        eq(bookings.status, "pending"),
        gt(bookings.holdExpiresAt, new Date()),
      ),
    )
    .returning({ id: bookings.id });

  if (!updated) {
    return NextResponse.json({ error: "Booking not found or hold expired" }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
