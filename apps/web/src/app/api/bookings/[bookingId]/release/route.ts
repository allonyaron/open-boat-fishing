import { NextRequest, NextResponse } from "next/server";
import { getOperatorId } from "@/lib/operator";
import { checkRateLimit, clientIp, tooManyRequests } from "@/lib/rate-limit";
import { releasePendingBooking } from "@/lib/bookings/release";
import { requireHoldToken } from "@/lib/bookings/hold-token";
import { z } from "zod";

// POST /api/bookings/:id/release — the checkout gives back an unpaid hold: it
// ran out on the page, or a new booking is replacing it (P2-3). Cancels the PI,
// then restores the seats.
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ bookingId: string }> },
) {
  const operatorId = getOperatorId(req);
  if (!operatorId) {
    return NextResponse.json({ error: "No operator configured" }, { status: 500 });
  }

  const rl = await checkRateLimit(`release-hold:${operatorId}:${clientIp(req)}`, 10, 15 * 60 * 1000);
  if (!rl.allowed) return tooManyRequests(rl.retryAfterSec);

  const { bookingId } = await params;
  if (!z.string().uuid().safeParse(bookingId).success) {
    return NextResponse.json({ error: "Booking not found" }, { status: 404 });
  }
  const denied = requireHoldToken(req, bookingId, operatorId);
  if (denied) return denied;

  const result = await releasePendingBooking(operatorId, bookingId);
  switch (result) {
    case "released":
      return NextResponse.json({ released: true });
    case "not_found":
      return NextResponse.json({ error: "Booking not found" }, { status: 404 });
    case "paid":
      return NextResponse.json({ error: "Booking is already paid" }, { status: 409 });
    case "error":
      return NextResponse.json({ error: "Payment service unavailable" }, { status: 502 });
  }
}
