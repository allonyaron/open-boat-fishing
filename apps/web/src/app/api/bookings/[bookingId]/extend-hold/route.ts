import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { bookings } from "@openboat/db";
import { and, eq } from "drizzle-orm";

const EXTEND_MS = 5 * 60 * 1000; // 5 extra minutes on payment attempt

export async function PATCH(
  _req: NextRequest,
  { params }: { params: Promise<{ bookingId: string }> },
) {
  const { bookingId } = await params;

  const [booking] = await db
    .select({ id: bookings.id, status: bookings.status, holdExpiresAt: bookings.holdExpiresAt })
    .from(bookings)
    .where(and(eq(bookings.id, bookingId), eq(bookings.status, "pending")));

  if (!booking) {
    return NextResponse.json({ error: "Booking not found or already completed" }, { status: 404 });
  }

  // Extend from whichever is later — current expiry or now — so a nearly-expired
  // hold still gets a full 5-minute window to complete the payment flow.
  const base = Math.max(booking.holdExpiresAt?.getTime() ?? Date.now(), Date.now());
  const newExpiresAt = new Date(base + EXTEND_MS);

  await db
    .update(bookings)
    .set({ holdExpiresAt: newExpiresAt, updatedAt: new Date() })
    .where(eq(bookings.id, bookingId));

  return NextResponse.json({ holdExpiresAt: newExpiresAt.toISOString() });
}
