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
import { eq, sql } from "drizzle-orm";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

// Wipes booking-side activity and restores per-trip seat inventory. Preserves
// customers (their accounts persist across the reset), fishing_reports (the
// captain's posts are a feature we're showcasing), and capacity_changes (audit
// trail of admin actions stays visible). Used by the nightly cron.
export async function resetBookingActivity(
  tx: Tx,
  operatorId: string,
): Promise<{ tripsReset: number }> {
  await tx.delete(checkIns).where(eq(checkIns.operatorId, operatorId));
  await tx.delete(tripOverrides).where(eq(tripOverrides.operatorId, operatorId));
  await tx.delete(payments).where(eq(payments.operatorId, operatorId));
  await tx.delete(tickets).where(eq(tickets.operatorId, operatorId));
  await tx.delete(bookingItems).where(eq(bookingItems.operatorId, operatorId));
  await tx.delete(bookings).where(eq(bookings.operatorId, operatorId));

  const seats = await tx
    .update(trips)
    .set({ seatsRemaining: sql`${trips.capacity}`, updatedAt: new Date() })
    .where(eq(trips.operatorId, operatorId))
    .returning({ id: trips.id });

  return { tripsReset: seats.length };
}

// Wipes customer accounts and everything that hangs off them. Assumes
// resetBookingActivity has already run (bookings reference customers, so they
// must be deleted first). Used by the manual admin "clear customers" action.
export async function resetCustomerAccounts(
  tx: Tx,
  operatorId: string,
): Promise<{ customersDeleted: number }> {
  await tx.delete(pushTokens).where(eq(pushTokens.operatorId, operatorId));
  await tx.delete(magicLinkOtps).where(eq(magicLinkOtps.operatorId, operatorId));
  const gone = await tx
    .delete(customers)
    .where(eq(customers.operatorId, operatorId))
    .returning({ id: customers.id });
  return { customersDeleted: gone.length };
}
