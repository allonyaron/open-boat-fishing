import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { bookings, bookingItems, trips, products, operators } from "@openboat/db";
import { and, eq } from "drizzle-orm";
import { getOperatorId } from "@/lib/operator";

function icsDate(d: Date | string): string {
  return new Date(d).toISOString().replace(/[-:]/g, "").split(".")[0] + "Z";
}

function escapeIcs(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\n/g, "\\n");
}

export async function GET(
  req: NextRequest,
  { params }: { params: { code: string } },
) {
  const operatorId = getOperatorId(req);
  if (!operatorId) return NextResponse.json({ error: "Operator not found" }, { status: 404 });

  const [operator] = await db
    .select({ name: operators.name, dockAddress: operators.dockAddress })
    .from(operators)
    .where(eq(operators.id, operatorId));

  if (!operator) return NextResponse.json({ error: "Operator not found" }, { status: 404 });

  const [booking] = await db
    .select({ id: bookings.id, confirmationCode: bookings.confirmationCode })
    .from(bookings)
    .where(and(eq(bookings.confirmationCode, params.code), eq(bookings.operatorId, operatorId)));

  if (!booking) return NextResponse.json({ error: "Booking not found" }, { status: 404 });

  const items = await db
    .select({
      startTime: trips.startTime,
      endTime: trips.endTime,
      productName: products.displayName,
    })
    .from(bookingItems)
    .innerJoin(trips, eq(trips.id, bookingItems.tripId))
    .innerJoin(products, eq(products.id, trips.productId))
    .where(eq(bookingItems.bookingId, booking.id));

  if (items.length === 0) return NextResponse.json({ error: "No trips found" }, { status: 404 });

  const location = operator.dockAddress ?? operator.name;
  const vevents = items
    .map((item, i) =>
      [
        "BEGIN:VEVENT",
        `UID:openboat-${booking.confirmationCode}-${i}@openboatfishing`,
        `SUMMARY:${escapeIcs(item.productName)}`,
        `DTSTART:${icsDate(item.startTime)}`,
        `DTEND:${icsDate(item.endTime)}`,
        `LOCATION:${escapeIcs(location)}`,
        `DESCRIPTION:Booking confirmation: ${booking.confirmationCode}`,
        "END:VEVENT",
      ].join("\r\n"),
    )
    .join("\r\n");

  const ics = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//OpenBoat//Booking//EN", vevents, "END:VCALENDAR"].join("\r\n");

  return new NextResponse(ics, {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": `attachment; filename="trip-${booking.confirmationCode}.ics"`,
    },
  });
}
