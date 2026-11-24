import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/session";
import { cancelTrip } from "@/lib/bookings/cancel-trip";

// A full boat is a few Stripe calls per booking, made one after another.
export const maxDuration = 60;

export async function POST(req: NextRequest, { params }: { params: { tripId: string } }) {
  const auth = await requireAdmin(req);
  if (auth instanceof NextResponse) return auth;
  const { session, ctx } = auth;

  const { tripId } = params;
  const { reason } = (await req.json().catch(() => ({}))) as { reason?: string };

  const result = await cancelTrip(ctx, session.operatorId, tripId, reason ?? null);

  if (result.kind === "not_found") {
    return NextResponse.json({ error: "Trip not found" }, { status: 404 });
  }
  if (result.kind === "already_cancelled") {
    return NextResponse.json({ error: "Trip is already cancelled" }, { status: 409 });
  }

  return NextResponse.json({
    ok: true,
    tripId,
    bookingsCancelled: result.bookingsCancelled,
    ticketsVoided: result.ticketsOut,
    refundedAt: ctx.now.toISOString(),
    refunds: result.refunds,
  });
}
