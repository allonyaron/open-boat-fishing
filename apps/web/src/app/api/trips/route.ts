import { NextRequest, NextResponse } from "next/server";
import { getOperatorId } from "@/lib/operator";
import { getTripsForMonth, isValidMonth } from "@/lib/trips/month";

export async function GET(req: NextRequest) {
  const month = req.nextUrl.searchParams.get("month");

  if (!month || !isValidMonth(month)) {
    return NextResponse.json({ error: "month param required, format: YYYY-MM" }, { status: 400 });
  }

  const operatorId = getOperatorId(req);
  if (!operatorId) {
    return NextResponse.json({ error: "No operator configured" }, { status: 500 });
  }

  return NextResponse.json(await getTripsForMonth(operatorId, month));
}
