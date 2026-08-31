import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { bookings } from "@openboat/db";
import { and, eq } from "drizzle-orm";
import { getOperatorId } from "@/lib/operator";
import { checkRateLimit, clientIp, tooManyRequests } from "@/lib/rate-limit";

const EXTEND_MS = 5 * 60 * 1000; // 5 extra minutes on payment attempt
const MAX_HOLD_MS = 90 * 60 * 1000; // hard cap: hold cannot exceed 90 min from creation

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ bookingId: string }> },
) {
  const operatorId = getOperatorId(req);
  if (!operatorId) {
    return NextResponse.json({ error: "No operator configured" }, { status: 500 });
  }

  const rl = await checkRateLimit(`extend-hold:${operatorId}:${clientIp(req)}`, 10, 15 * 60 * 1000);
  if (!rl.allowed) return tooManyRequests(rl.retryAfterSec);

  const { bookingId } = await params;

  const [booking] = await db
    .select({
      id: bookings.id,
      status: bookings.status,
      holdExpiresAt: bookings.holdExpiresAt,
      createdAt: bookings.createdAt,
    })
    .from(bookings)
    .where(and(eq(bookings.id, bookingId), eq(bookings.operatorId, operatorId), eq(bookings.status, "pending")));

  if (!booking) {
    return NextResponse.json({ error: "Booking not found or already completed" }, { status: 404 });
  }

  // Hard cap: never extend past 90 minutes from creation to prevent seat-hoarding.
  const maxExpiresAt = new Date(booking.createdAt.getTime() + MAX_HOLD_MS);
  if (Date.now() >= maxExpiresAt.getTime()) {
    return NextResponse.json({ error: "Hold lifetime limit reached" }, { status: 409 });
  }

  // Extend from whichever is later — current expiry or now — so a nearly-expired
  // hold still gets a full 5-minute window to complete the payment flow.
  const base = Math.max(booking.holdExpiresAt?.getTime() ?? Date.now(), Date.now());
  const newExpiresAt = new Date(Math.min(base + EXTEND_MS, maxExpiresAt.getTime()));

  await db
    .update(bookings)
    .set({ holdExpiresAt: newExpiresAt, updatedAt: new Date() })
    .where(and(eq(bookings.id, bookingId), eq(bookings.operatorId, operatorId)));

  return NextResponse.json({ holdExpiresAt: newExpiresAt.toISOString() });
}
