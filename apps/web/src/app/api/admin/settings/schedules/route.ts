import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/session";
import { schedules, trips, products, vessels } from "@openboat/db";
import { and, eq } from "drizzle-orm";

type DayOfWeek = "mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun";
const DOW_TO_JS: Record<DayOfWeek, number> = {
  sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6,
};

function datesInRange(start: string, end: string, days: DayOfWeek[]): string[] {
  const dayNums = days.map((d) => DOW_TO_JS[d]);
  const result: string[] = [];
  const cur = new Date(start + "T12:00:00Z");
  const endDate = new Date(end + "T12:00:00Z");
  while (cur <= endDate) {
    if (dayNums.includes(cur.getUTCDay())) {
      result.push(cur.toISOString().slice(0, 10));
    }
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return result;
}

function parseTime(t: string): { hours: number; minutes: number } | null {
  const m = /^(\d{1,2}):(\d{2})(?::\d{2})?$/.exec(t);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return { hours: h, minutes: min };
}

function toTimeString(h: number, m: number) {
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:00`;
}

export async function GET(req: NextRequest) {
  const auth = await requireAdmin(req);
  if (auth instanceof NextResponse) return auth;
  const { session } = auth;

  const rows = await db
    .select({
      id: schedules.id,
      productId: schedules.productId,
      startDate: schedules.startDate,
      endDate: schedules.endDate,
      daysOfWeek: schedules.daysOfWeek,
      departureTime: schedules.departureTime,
      returnTime: schedules.returnTime,
      capacity: schedules.capacity,
      active: schedules.active,
      createdAt: schedules.createdAt,
      product: {
        id: products.id,
        displayName: products.displayName,
        category: products.category,
      },
      vessel: {
        id: vessels.id,
        name: vessels.name,
        color: vessels.color,
      },
    })
    .from(schedules)
    .innerJoin(products, eq(schedules.productId, products.id))
    .innerJoin(vessels, eq(products.vesselId, vessels.id))
    .where(eq(schedules.operatorId, session.operatorId))
    .orderBy(schedules.startDate);

  return NextResponse.json(rows);
}

export async function POST(req: NextRequest) {
  const auth = await requireAdmin(req);
  if (auth instanceof NextResponse) return auth;
  const { session } = auth;

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;

  const productId = String(body.productId ?? "").trim();
  if (!productId) return NextResponse.json({ error: "productId is required" }, { status: 400 });

  const startDate = String(body.startDate ?? "").trim();
  const endDate = String(body.endDate ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate))
    return NextResponse.json({ error: "startDate must be YYYY-MM-DD" }, { status: 400 });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(endDate))
    return NextResponse.json({ error: "endDate must be YYYY-MM-DD" }, { status: 400 });
  if (endDate < startDate)
    return NextResponse.json({ error: "endDate must be on or after startDate" }, { status: 400 });

  const daysOfWeek = body.daysOfWeek as DayOfWeek[] | undefined;
  const validDays: DayOfWeek[] = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
  if (!Array.isArray(daysOfWeek) || daysOfWeek.length === 0 || !daysOfWeek.every((d) => validDays.includes(d)))
    return NextResponse.json({ error: "daysOfWeek must be a non-empty array of day abbreviations" }, { status: 400 });

  const depParsed = parseTime(String(body.departureTime ?? ""));
  const retParsed = parseTime(String(body.returnTime ?? ""));
  if (!depParsed) return NextResponse.json({ error: "departureTime must be HH:MM" }, { status: 400 });
  if (!retParsed) return NextResponse.json({ error: "returnTime must be HH:MM" }, { status: 400 });

  const capacity = Number(body.capacity);
  if (!Number.isInteger(capacity) || capacity < 1)
    return NextResponse.json({ error: "capacity must be a positive integer" }, { status: 400 });

  // Ensure product belongs to this operator
  const [product] = await db
    .select({ id: products.id, vesselId: products.vesselId })
    .from(products)
    .where(and(eq(products.id, productId), eq(products.operatorId, session.operatorId)));

  if (!product) return NextResponse.json({ error: "Product not found" }, { status: 404 });

  const departureTime = toTimeString(depParsed.hours, depParsed.minutes);
  const returnTime = toTimeString(retParsed.hours, retParsed.minutes);

  const [schedule] = await db
    .insert(schedules)
    .values({
      operatorId: session.operatorId,
      productId,
      startDate,
      endDate,
      daysOfWeek,
      departureTime,
      returnTime,
      capacity,
    })
    .returning();

  // Materialize trips — identical logic to seed-trips-dev.ts
  const dates = datesInRange(startDate, endDate, daysOfWeek);
  const isOvernight = retParsed.hours < depParsed.hours || (retParsed.hours === depParsed.hours && retParsed.minutes < depParsed.minutes);

  const tripRows = dates.map((date) => {
    const retDate = isOvernight
      ? new Date(new Date(date + "T00:00:00Z").getTime() + 86_400_000).toISOString().slice(0, 10)
      : date;
    return {
      operatorId: session.operatorId,
      scheduleId: schedule.id,
      productId,
      vesselId: product.vesselId,
      departureDate: date,
      startTime: new Date(`${date}T${departureTime}Z`),
      endTime: new Date(`${retDate}T${returnTime}Z`),
      capacity,
      seatsRemaining: capacity,
    };
  });

  let tripsCreated = 0;
  if (tripRows.length > 0) {
    await db.insert(trips).values(tripRows).onConflictDoNothing();
    tripsCreated = tripRows.length;
  }

  return NextResponse.json({ ...schedule, tripsCreated }, { status: 201 });
}
