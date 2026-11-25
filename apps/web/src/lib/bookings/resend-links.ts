import { and, asc, eq, max, min } from "drizzle-orm";
import { bookingItems, bookings, operators, products, trips } from "@openboat/db";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { sendBookingLinksEmail } from "@/lib/email";
import { fmtTimeET } from "@/lib/format";
import { boardingPassPath, bookingLinksOpen } from "./booking-key";

// "Email my link" (P8-1, row 15): a customer who has lost the confirmation
// email gets each of their bookings' links again, sent to the address on the
// booking. The page that asks never learns whether anything was found, so
// typing someone else's address reveals nothing and opens nothing.

/** Most bookings one email lists. */
const MAX_LINKS = 10;

export type BookingLink = { confirmationCode: string; tripLabel: string; url: string };

/** The operator's confirmed bookings for this address whose links still open, soonest first. */
export async function findBookingLinks(operatorId: string, email: string, now: Date = new Date()): Promise<BookingLink[]> {
  const rows = await db
    .select({
      id: bookings.id,
      confirmationCode: bookings.confirmationCode,
      firstStart: min(trips.startTime),
      lastEnd: max(trips.endTime),
      productName: min(products.displayName),
    })
    .from(bookings)
    .innerJoin(bookingItems, eq(bookingItems.bookingId, bookings.id))
    .innerJoin(trips, eq(trips.id, bookingItems.tripId))
    .innerJoin(products, eq(products.id, trips.productId))
    .where(
      and(
        eq(bookings.operatorId, operatorId),
        eq(bookings.customerEmail, email),
        eq(bookings.status, "confirmed"),
      ),
    )
    .groupBy(bookings.id, bookings.confirmationCode)
    .orderBy(asc(min(trips.startTime)));

  const base = env.NEXT_PUBLIC_APP_URL ?? "";
  return rows
    .filter((r) => r.lastEnd && bookingLinksOpen(new Date(r.lastEnd), now))
    .slice(0, MAX_LINKS)
    .map((r) => {
      const start = new Date(r.firstStart!);
      const date = start.toLocaleDateString("en-US", {
        weekday: "short",
        month: "short",
        day: "numeric",
        timeZone: "America/New_York",
      });
      return {
        confirmationCode: r.confirmationCode,
        tripLabel: `${r.productName} · ${date} · ${fmtTimeET(start.toISOString())}`,
        url: `${base}${boardingPassPath(operatorId, r.id)}`,
      };
    });
}

/** Emails the address its bookings' links; sends nothing when there are none. */
export async function sendBookingLinks(operatorId: string, email: string): Promise<void> {
  const links = await findBookingLinks(operatorId, email);
  if (links.length === 0) return;
  const [operator] = await db
    .select({ name: operators.name, emailFrom: operators.emailFrom })
    .from(operators)
    .where(eq(operators.id, operatorId));
  if (!operator) return;
  await sendBookingLinksEmail({
    to: email,
    operatorName: operator.name ?? "Fishing Charter",
    fromAddress: operator.emailFrom,
    links,
  });
}
