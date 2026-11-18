import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { bookings } from "@openboat/db";

// Wording for the notes an event leaves on the Money page's "Needs
// attention" list: confirmation codes and dollars, not ids and cents.

export function usd(cents: number): string {
  return (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });
}

/** "Booking K7Q2MX", or a plain "A booking" if it can't be found. */
export async function bookingLabel(bookingId: string): Promise<string> {
  const [row] = await db
    .select({ code: bookings.confirmationCode })
    .from(bookings)
    .where(eq(bookings.id, bookingId));
  return row ? `Booking ${row.code}` : "A booking";
}
