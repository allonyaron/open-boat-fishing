import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { sendPushToEmails } from "@/lib/push";
import { trips, bookingItems, bookings, vessels, products } from "@openboat/db";
import { and, eq, gte, lt, inArray } from "drizzle-orm";

export const dynamic = "force-dynamic";

// Vercel cron: runs every hour via vercel.json
// Finds trips departing in [+23h, +24h) and sends reminder pushes.
// Half-open interval prevents double-firing when consecutive hourly runs overlap.
export async function GET(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const now = new Date();
  const windowStart = new Date(now.getTime() + 23 * 60 * 60 * 1000);
  const windowEnd = new Date(now.getTime() + 24 * 60 * 60 * 1000);

  const upcomingTrips = await db
    .select({
      id: trips.id,
      operatorId: trips.operatorId,
      startTime: trips.startTime,
      vesselName: vessels.name,
      productName: products.displayName,
    })
    .from(trips)
    .innerJoin(vessels, eq(trips.vesselId, vessels.id))
    .innerJoin(products, eq(trips.productId, products.id))
    .where(
      and(
        eq(trips.status, "scheduled"),
        gte(trips.startTime, windowStart),
        lt(trips.startTime, windowEnd),
      ),
    );

  let sent = 0;
  for (const trip of upcomingTrips) {
    const items = await db
      .select({ bookingId: bookingItems.bookingId })
      .from(bookingItems)
      .where(eq(bookingItems.tripId, trip.id));

    if (items.length === 0) continue;

    const bookingIds = [...new Set(items.map((i) => i.bookingId))];
    const bookedPassengers = await db
      .select({ email: bookings.customerEmail })
      .from(bookings)
      .where(and(inArray(bookings.id, bookingIds), eq(bookings.status, "confirmed")));

    const emails = bookedPassengers.map((b) => b.email).filter(Boolean) as string[];
    if (emails.length === 0) continue;

    const departs = new Date(trip.startTime).toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    });

    await sendPushToEmails(
      trip.operatorId,
      emails,
      {
        title: "Trip Reminder",
        body: `Your ${trip.vesselName} ${trip.productName} departs tomorrow at ${departs}. See you at the dock!`,
        data: { type: "trip_reminder", tripId: trip.id },
      },
      "reminders",
    );
    sent += emails.length;
  }

  return NextResponse.json({ ok: true, tripsProcessed: upcomingTrips.length, pushSent: sent });
}
