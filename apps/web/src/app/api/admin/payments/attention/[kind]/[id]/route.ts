import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/session";
import { resolveAttention, retryCommand } from "@/lib/payments/attention";

const bodySchema = z.object({ action: z.enum(["retry", "resolve"]) });

// POST /api/admin/payments/attention/:kind/:id  { action: "retry" | "resolve" }
// Retry sends a refund again; resolve marks an item dealt with (row 10).
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
