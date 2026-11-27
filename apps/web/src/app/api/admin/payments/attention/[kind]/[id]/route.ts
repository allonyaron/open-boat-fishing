import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/session";
import { resolveAttention, retryCommand } from "@/lib/payments/attention";
import { markOutsideRefund } from "@/lib/payments/outside-refund";

const bodySchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("retry") }),
  z.object({ action: z.literal("resolve") }),
  z.object({ action: z.literal("mark_ticket"), ticketId: z.string().uuid() }),
]);

// POST /api/admin/payments/attention/:kind/:id
//   { action: "retry" | "resolve" } — retry sends a refund again; resolve marks an item dealt with (row 10).
//   { action: "mark_ticket", ticketId } — on a partial refund made outside the app, says which ticket it
//   was for: the ticket is refunded without paying the customer again and its platform fee returned (row 32).
export async function POST(
  req: NextRequest,
  { params }: { params: { kind: string; id: string } },
) {
  const auth = await requireAdmin(req);
  if (auth instanceof NextResponse) return auth;
  const { session, ctx } = auth;

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  const kind = params.kind;
  if (kind !== "command" && kind !== "event") {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  if (parsed.data.action === "mark_ticket") {
    if (kind !== "event") return NextResponse.json({ error: "Not found" }, { status: 404 });
    const result = await markOutsideRefund(ctx, {
      operatorId: session.operatorId,
      eventId: params.id,
      ticketId: parsed.data.ticketId,
    });
    if (result.kind === "not_found") return NextResponse.json({ error: "Not found" }, { status: 404 });
    if (result.kind === "not_refundable") {
      return NextResponse.json({ error: "That ticket was already refunded or can't board." }, { status: 409 });
    }
    if (result.kind === "over_amount") {
      return NextResponse.json(
        { error: "That ticket costs more than what's left of the refund made in Stripe.", leftCents: result.leftCents },
        { status: 409 },
      );
    }
    return NextResponse.json({ ok: true, ...result });
  }

  if (parsed.data.action === "retry") {
    if (kind !== "command") return NextResponse.json({ error: "Only a refund can be retried" }, { status: 400 });
    const result = await retryCommand(ctx, session.operatorId, params.id);
    if (result === "not_found") return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json({ ok: true, result });
  }

  const resolved = await resolveAttention(ctx, session.operatorId, kind, params.id);
  if (!resolved) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
