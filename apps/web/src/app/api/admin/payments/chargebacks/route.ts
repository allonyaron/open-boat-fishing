import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/session";
import { listChargebacks } from "@/lib/disputes/list";

export const dynamic = "force-dynamic";

// The Money page's chargeback list (row 11).
export async function GET(req: NextRequest) {
  const auth = await requireAdmin(req);
  if (auth instanceof NextResponse) return auth;
  const { session } = auth;

  return NextResponse.json({ items: await listChargebacks(session.operatorId) });
}
