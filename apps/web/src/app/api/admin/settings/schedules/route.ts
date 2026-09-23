import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/session";
import { schedules, trips, products, vessels } from "@openboat/db";
import { and, eq } from "drizzle-orm";
import {
  type DayOfWeek,
  VALID_DAYS,
  datesInRange,
  parseTime,
  toTimeString,
  isOvernight,
  tripEndDate,
} from "@/lib/trip-materialization";

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
  if (!Array.isArray(daysOfWeek) || daysOfWeek.length === 0 || !daysOfWeek.every((d) => VALID_DAYS.includes(d)))
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
  const overnight = isOvernight(depParsed, retParsed);

  const tripRows = dates.map((date) => {
    const retDate = tripEndDate(date, returnTime, overnight);
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
