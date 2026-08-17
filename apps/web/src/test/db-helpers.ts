/**
 * Test DB helpers — seed and tear down per test suite.
 *
 * Each call to `seedOperator()` creates a fully isolated operator subtree
 * (operator → vessel → product → prices → schedule → trip + staff).
 * Call `cleanupOperator(operatorId)` in afterAll to delete everything.
 */
import { createDb } from "@openboat/db";
import {
  operators,
  vessels,
  products,
  productPrices,
  schedules,
  trips,
  staff,
  bookings,
  bookingItems,
  tickets,
  checkIns,
  payments,
  fishingReports,
} from "@openboat/db";
import { eq } from "drizzle-orm";
import { randomUUID } from "crypto";
import bcrypt from "bcryptjs";

// Separate connection pool for helpers so we don't share state with the app module
const testDb = createDb(process.env.DATABASE_URL!);

export { testDb };

export type SeedResult = {
  operatorId: string;
  vesselId: string;
  productId: string;
  scheduleId: string;
  tripId: string;
  staffId: string;
  staffEmail: string;
  /** A valid mate Bearer token for this operator */
  mateToken: string;
};

/** Seed a minimal but complete operator subtree and return the IDs. */
export async function seedOperator(): Promise<SeedResult> {
  const slug = `test-op-${randomUUID().slice(0, 8)}`;
  const [op] = await testDb
    .insert(operators)
    .values({
      name: "Test Operator",
      slug,
      emailFrom: `noreply@${slug}.test`,
      emailDomain: `${slug}.test`,
      settleGraceHrs: 48,
    })
    .returning({ id: operators.id });

  const [vessel] = await testDb
    .insert(vessels)
    .values({
      operatorId: op.id,
      name: "Test Vessel",
      slug: "test-vessel",
      color: "#1E88E5",
      capacity: 20,
    })
    .returning({ id: vessels.id });

  const [product] = await testDb
    .insert(products)
    .values({
      operatorId: op.id,
      vesselId: vessel.id,
      displayName: "Party Fishing",
      category: "fishing",
      active: true,
    })
    .returning({ id: products.id });

  await testDb.insert(productPrices).values([
    { productId: product.id, ticketType: "adult", priceCents: 10000, active: true },
    { productId: product.id, ticketType: "child", priceCents: 6000, active: true },
  ]);

  const today = new Date().toISOString().slice(0, 10);
  const yearEnd = `${new Date().getFullYear()}-12-31`;
  const [schedule] = await testDb
    .insert(schedules)
    .values({
      operatorId: op.id,
      productId: product.id,
      startDate: today,
      endDate: yearEnd,
      departureTime: "07:00:00",
      returnTime: "15:00:00",
      daysOfWeek: ["mon", "tue", "wed", "thu", "fri", "sat", "sun"],
      capacity: 20,
      active: true,
    })
    .returning({ id: schedules.id });

  const [trip] = await testDb
    .insert(trips)
    .values({
      operatorId: op.id,
      scheduleId: schedule.id,
      vesselId: vessel.id,
      productId: product.id,
      departureDate: today,
      startTime: new Date(`${today}T07:00:00-05:00`),
      endTime: new Date(`${today}T15:00:00-05:00`),
      capacity: 20,
      seatsRemaining: 20,
      status: "scheduled",
    })
    .returning({ id: trips.id });

  const staffEmail = `mate-${randomUUID().slice(0, 8)}@test.com`;
  const pinHash = await bcrypt.hash("1234", 10);
  const [staffRow] = await testDb
    .insert(staff)
    .values({
      operatorId: op.id,
      name: "Test Mate",
      email: staffEmail,
      pinHash,
      role: "mate",
      active: true,
    })
    .returning({ id: staff.id });

  // Generate a real mate token (same HMAC logic as signMateToken)
  const { signMateToken } = await import("@/lib/mate-auth");
  const mateToken = signMateToken({
    staffId: staffRow.id,
    operatorId: op.id,
    role: "mate",
    name: "Test Mate",
  });

  return {
    operatorId: op.id,
    vesselId: vessel.id,
    productId: product.id,
    scheduleId: schedule.id,
    tripId: trip.id,
    staffId: staffRow.id,
    staffEmail,
    mateToken,
  };
}

export type BookingSeedResult = {
  bookingId: string;
  bookingItemId: string;
  ticketId: string;
};

/**
 * Seed a minimal booking (bookingItem + ticket) for the given operator/trip.
 * Defaults to a pending booking with holdExpiresAt already expired (useful for
 * cron-expire tests). Pass opts to override status or expiry.
 */
export async function seedBooking(
  ctx: SeedResult,
  opts: {
    status?: "pending" | "confirmed" | "cancelled";
    holdExpiresAt?: Date;
    stripePaymentIntentId?: string;
  } = {},
): Promise<BookingSeedResult> {
  const code = randomUUID().slice(0, 6).toUpperCase();
  const [booking] = await testDb
    .insert(bookings)
    .values({
      operatorId: ctx.operatorId,
      confirmationCode: code,
      status: opts.status ?? "pending",
      totalCents: 10000,
      platformFeeCents: 150,
      customerEmail: `test-${randomUUID().slice(0, 6)}@test.com`,
      holdExpiresAt: opts.holdExpiresAt ?? new Date(Date.now() - 60_000), // 1 min ago
      stripePaymentIntentId: opts.stripePaymentIntentId ?? null,
    })
    .returning({ id: bookings.id });

  const [item] = await testDb
    .insert(bookingItems)
    .values({
      bookingId: booking.id,
      tripId: ctx.tripId,
      operatorId: ctx.operatorId,
      subtotalCents: 10000,
    })
    .returning({ id: bookingItems.id });

  const [ticket] = await testDb
    .insert(tickets)
    .values({
      bookingItemId: item.id,
      bookingId: booking.id,
      operatorId: ctx.operatorId,
      ticketType: "adult",
      priceCents: 10000,
      feeAmountCents: 150,
      qrPayload: randomUUID(),
    })
    .returning({ id: tickets.id });

  return { bookingId: booking.id, bookingItemId: item.id, ticketId: ticket.id };
}

/** Reset trip seats and delete all booking-related rows for a trip. */
export async function cleanupBookings(tripId: string, originalCapacity = 20) {
  // Find all booking items for this trip to cascade deletes correctly
  const itemRows = await testDb
    .select({ id: bookingItems.id, bookingId: bookingItems.bookingId })
    .from(bookingItems)
    .where(eq(bookingItems.tripId, tripId));

  if (itemRows.length > 0) {
    const bookingIds = [...new Set(itemRows.map((r) => r.bookingId))];
    const itemIds = itemRows.map((r) => r.id);

    // Delete in FK order
    await testDb.delete(checkIns).where(eq(checkIns.tripId, tripId));
    for (const itemId of itemIds) {
      await testDb.delete(tickets).where(eq(tickets.bookingItemId, itemId));
    }
    for (const bookingId of bookingIds) {
      await testDb.delete(payments).where(eq(payments.bookingId, bookingId));
      await testDb.delete(bookingItems).where(eq(bookingItems.bookingId, bookingId));
      await testDb.delete(bookings).where(eq(bookings.id, bookingId));
    }
  }

  await testDb
    .update(trips)
    .set({ seatsRemaining: originalCapacity })
    .where(eq(trips.id, tripId));
}

/** Delete the entire operator subtree — call in afterAll. */
export async function cleanupOperator(operatorId: string) {
  // Cascade down the FK chain
  await testDb.delete(fishingReports).where(eq(fishingReports.operatorId, operatorId));
  await testDb.delete(checkIns).where(eq(checkIns.operatorId, operatorId));
  await testDb.delete(tickets).where(eq(tickets.operatorId, operatorId));
  await testDb.delete(payments).where(eq(payments.operatorId, operatorId));
  await testDb.delete(bookingItems).where(eq(bookingItems.operatorId, operatorId));
  await testDb.delete(bookings).where(eq(bookings.operatorId, operatorId));
  await testDb.delete(trips).where(eq(trips.operatorId, operatorId));
  await testDb.delete(schedules).where(eq(schedules.operatorId, operatorId));
  await testDb.delete(productPrices).where(
    eq(
      productPrices.productId,
      testDb
        .select({ id: products.id })
        .from(products)
        .where(eq(products.operatorId, operatorId))
        .limit(1),
    ),
  );
  await testDb.delete(products).where(eq(products.operatorId, operatorId));
  await testDb.delete(staff).where(eq(staff.operatorId, operatorId));
  await testDb.delete(vessels).where(eq(vessels.operatorId, operatorId));
  await testDb.delete(operators).where(eq(operators.id, operatorId));
}
