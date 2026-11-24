import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/session";
import { refundTicket } from "@/lib/bookings/refund-ticket";
import { sendCommands } from "@/lib/payments/commands";

export async function POST(req: NextRequest, { params }: { params: { ticketId: string } }) {
  const auth = await requireAdmin(req);
  if (auth instanceof NextResponse) return auth;
  const { session, ctx } = auth;

  const { ticketId } = params;
  const result = await refundTicket(ctx, { operatorId: session.operatorId, ticketId });

  switch (result.kind) {
    case "not_found":
      return NextResponse.json({ error: "Ticket not found" }, { status: 404 });
    case "unpaid":
      return NextResponse.json({ error: "Ticket isn't paid for" }, { status: 409 });
    case "already_refunded":
      return NextResponse.json({ error: "Ticket already refunded" }, { status: 409 });
    case "not_refundable":
      return NextResponse.json({ error: "Booking is not in a refundable state" }, { status: 409 });
  }

  // Send now. A failure doesn't undo the refund: the request stays queued and
  // is retried, or shows on the Money page if Stripe refuses it.
  const sent = await sendCommands(result.commandIds);
  const refund = sent.failed > 0 ? "failed" : sent.pending > 0 ? "queued" : "sent";

  return NextResponse.json({ ok: true, ticketId, refundedCents: result.refundedCents, refund });
}
