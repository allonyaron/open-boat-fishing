import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getOperatorId } from "@/lib/operator";

export async function GET(req: NextRequest) {
  const month = req.nextUrl.searchParams.get("month");

  if (!month || !/^\d{4}-\d{2}$/.test(month)) {
    return NextResponse.json({ error: "month param required, format: YYYY-MM" }, { status: 400 });
  }

  const [year, mon] = month.split("-").map(Number);
  const startDate = `${month}-01`;
  const lastDay = new Date(year, mon, 0).getDate();
  const endDate = `${month}-${String(lastDay).padStart(2, "0")}`;

  const operatorId = getOperatorId(req);
  if (!operatorId) {
    return NextResponse.json({ error: "No operator configured" }, { status: 500 });
  }

  const trips = await db.query.trips.findMany({
    where: (t, { eq, and, gte, lte }) =>
      and(
        eq(t.operatorId, operatorId),
        gte(t.departureDate, startDate),
        lte(t.departureDate, endDate),
        eq(t.status, "scheduled"),
      ),
    with: {
      vessel: true,
      product: {
        with: {
          prices: {
            where: (p, { eq }) => eq(p.active, true),
          },
        },
      },
    },
    orderBy: (t, { asc }) => [asc(t.departureDate), asc(t.startTime)],
  });

  return NextResponse.json(trips);
}
