import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/session";
import { listAttention } from "@/lib/payments/attention";

export const dynamic = "force-dynamic";

// The Money page's "Needs attention" list (row 10).
export async function GET(req: NextRequest) {
  const auth = await requireAdmin(req);
  if (auth instanceof NextResponse) return auth;
  const { session } = auth;

  return NextResponse.json({ items: await listAttention(session.operatorId) });
}
