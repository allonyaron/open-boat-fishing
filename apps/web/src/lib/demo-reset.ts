import type { db } from "@/lib/db";
import {
  bookings,
  bookingItems,
  tickets,
  payments,
  checkIns,
  tripOverrides,
  trips,
  customers,
  magicLinkOtps,
  pushTokens,
} from "@openboat/db";
import { sql } from "drizzle-orm";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

// Wipes booking-side activity and restores per-trip seat inventory. Preserves
// customers (their accounts persist across the reset), fishing_reports (the
// captain's posts are a feature we're showcasing), and capacity_changes (audit
// trail of admin actions stays visible). Used by the nightly cron.
export async function resetBookingActivity(tx: Tx): Promise<{ tripsReset: number }> {
  await tx.delete(checkIns);
  await tx.delete(tripOverrides);
  await tx.delete(payments);
  await tx.delete(tickets);
  await tx.delete(bookingItems);
  await tx.delete(bookings);

  const seats = await tx
    .update(trips)
    .set({ seatsRemaining: sql`${trips.capacity}`, updatedAt: new Date() })
    .returning({ id: trips.id });

  return { tripsReset: seats.length };
}

// Wipes customer accounts and everything that hangs off them. Assumes
// resetBookingActivity has already run (bookings reference customers, so they
// must be deleted first). Used by the manual admin "clear customers" action.
export async function resetCustomerAccounts(tx: Tx): Promise<{ customersDeleted: number }> {
  await tx.delete(pushTokens);
  await tx.delete(magicLinkOtps);
  const gone = await tx.delete(customers).returning({ id: customers.id });
  return { customersDeleted: gone.length };
}
