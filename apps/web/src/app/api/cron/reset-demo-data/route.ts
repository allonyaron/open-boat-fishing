import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { getOperatorId } from "@/lib/operator";
import { resetBookingActivity } from "@/lib/demo-reset";

export const dynamic = "force-dynamic";

// Nightly reset for the openboatfishing.com demo deployment. Wipes booking
// activity and restores trip seat inventory so anyone hitting the demo the
// next day sees a clean, fully-available calendar. Operator, vessels,
// products, prices, schedules, staff, customers, and fishing reports persist.
//
// Guarded twice: CRON_SECRET header (all environments) AND DEMO_MODE=true
// (safety net so this endpoint is a no-op on any accidental deploy to a real
// operator's environment).
export async function GET(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  if (authHeader !== `Bearer ${env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (env.DEMO_MODE !== "true") {
    return NextResponse.json(
      { error: "DEMO_MODE not enabled — refusing to wipe data" },
      { status: 403 },
    );
  }

  const operatorId = getOperatorId(req);
  if (!operatorId) {
    return NextResponse.json({ error: "No operator configured" }, { status: 500 });
  }

  const result = await db.transaction((tx) => resetBookingActivity(tx, operatorId));

  console.log(`Demo data reset — restored seat inventory on ${result.tripsReset} trips`);
  return NextResponse.json({ ok: true, tripsReset: result.tripsReset });
}
