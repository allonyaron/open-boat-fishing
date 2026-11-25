import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { requireAdmin } from "@/lib/session";
import { recordAudit } from "@/lib/audit";
import { resetBookingActivity, resetCustomerAccounts } from "@/lib/demo-reset";

export const dynamic = "force-dynamic";

// Manual "clear customers" for the demo deployment. Runs the same wipe as the
// nightly cron AND deletes all customer accounts + their push tokens + OTPs.
// Because bookings reference customers (via nullable FK), booking activity has
// to be wiped in the same transaction — otherwise the customer delete would
// fail on the FK check.
export async function POST(req: NextRequest) {
  const auth = await requireAdmin(req);
  if (auth instanceof NextResponse) return auth;

  if (env.DEMO_MODE !== "true") {
    return NextResponse.json(
      { error: "DEMO_MODE not enabled" },
      { status: 403 },
    );
  }

  const operatorId = auth.session.operatorId;
  const result = await db.transaction(async (tx) => {
    const bookingsResult = await resetBookingActivity(tx, operatorId);
    const customersResult = await resetCustomerAccounts(tx, operatorId);
    const counts = { ...bookingsResult, ...customersResult };
    // It deletes paid bookings, so it says who did it (row 12, P7-10).
    await recordAudit(tx, auth.ctx, {
      operatorId,
      action: "demo.clear_customers",
      targetTable: "operators",
      targetId: operatorId,
      after: counts,
    });
    return counts;
  });

  return NextResponse.json({ ok: true, ...result });
}
