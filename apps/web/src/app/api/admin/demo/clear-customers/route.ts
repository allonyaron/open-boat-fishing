import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { requireAdmin } from "@/lib/session";
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

  const result = await db.transaction(async (tx) => {
    const bookingsResult = await resetBookingActivity(tx, auth.session.operatorId);
    const customersResult = await resetCustomerAccounts(tx, auth.session.operatorId);
    return { ...bookingsResult, ...customersResult };
  });

  return NextResponse.json({ ok: true, ...result });
}
