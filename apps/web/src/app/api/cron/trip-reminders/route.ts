import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { sendPushToEmails } from "@/lib/push";
import { trips, bookingItems, bookings, vessels, products } from "@openboat/db";
import { and, eq, gte, lt } from "drizzle-orm";

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

  // Single join — no N+1 per trip
  const rows = await db
    .select({
      tripId: trips.id,
      operatorId: trips.operatorId,
      startTime: trips.startTime,
      vesselName: vessels.name,
      productName: products.displayName,
      email: bookings.customerEmail,
    })
    .from(trips)
    .innerJoin(vessels, eq(trips.vesselId, vessels.id))
    .innerJoin(products, eq(trips.productId, products.id))
    .innerJoin(bookingItems, eq(bookingItems.tripId, trips.id))
    .innerJoin(
      bookings,
      and(eq(bookings.id, bookingItems.bookingId), eq(bookings.status, "confirmed")),
    )
    .where(
      and(
        eq(trips.status, "scheduled"),
        gte(trips.startTime, windowStart),
        lt(trips.startTime, windowEnd),
      ),
    );

  // Group emails by trip
  type TripMeta = { operatorId: string; startTime: Date; vesselName: string; productName: string };
  const byTrip = new Map<string, { meta: TripMeta; emails: Set<string> }>();
  for (const row of rows) {
    if (!byTrip.has(row.tripId)) {
      byTrip.set(row.tripId, {
        meta: {
          operatorId: row.operatorId,
          startTime: row.startTime,
          vesselName: row.vesselName,
          productName: row.productName,
        },
        emails: new Set(),
      });
    }
    if (row.email) byTrip.get(row.tripId)!.emails.add(row.email);
  }

  let sent = 0;
  for (const [tripId, { meta, emails }] of byTrip) {
    const emailList = [...emails];
    if (emailList.length === 0) continue;

    const departs = new Date(meta.startTime).toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    });

    await sendPushToEmails(
      meta.operatorId,
      emailList,
      {
        title: "Trip Reminder",
        body: `Your ${meta.vesselName} ${meta.productName} departs tomorrow at ${departs}. See you at the dock!`,
        data: { type: "trip_reminder", tripId },
      },
      "reminders",
    );
    sent += emailList.length;
  }

  return NextResponse.json({ ok: true, tripsProcessed: byTrip.size, pushSent: sent });
}
