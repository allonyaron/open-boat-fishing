/**
 * Fixtures for e2e/admin-money.spec.ts: two one-off trips 30 days out, each
 * with a paid booking, and one refund Stripe refused. Removes the previous
 * run's fixtures first, so it is safe to re-run before every spec run.
 *
 * Usage (after seed-demo.ts and seed-admin.ts):
 *   cd packages/db && DATABASE_URL=... tsx src/seed-e2e-admin.ts
 *
 * Exports the names the spec looks for.
 */
import { randomUUID } from "crypto";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { and, eq, inArray, like } from "drizzle-orm";
import * as schema from "./schema.js";

export const E2E_REFUND_PRODUCT = "E2E Refund Trip";
export const E2E_CANCEL_PRODUCT = "E2E Cancel Trip";
export const E2E_REFUSED_NOTE = "E2E sample refusal: Refund amount is greater than the unrefunded amount.";
export const E2E_DAYS_AHEAD = 30;

/** YYYY-MM-DD, E2E_DAYS_AHEAD days from today (UTC). */
export function e2eTripDate(now: Date = new Date()): string {
  return new Date(now.getTime() + E2E_DAYS_AHEAD * 86_400_000).toISOString().slice(0, 10);
}

const PRICE_CENTS = 6800;

async function run() {
  const DATABASE_URL = process.env.DATABASE_URL;
  if (!DATABASE_URL) throw new Error("DATABASE_URL is not set");
  const client = postgres(DATABASE_URL);
  const db = drizzle(client, { schema });

  const [op] = await db.select().from(schema.operators).where(eq(schema.operators.slug, "mv-open-boat"));
  if (!op) throw new Error("Demo operator mv-open-boat not found. Run seed-demo.ts first.");
  const [vessel] = await db.select().from(schema.vessels).where(eq(schema.vessels.operatorId, op.id)).limit(1);
  if (!vessel) throw new Error("Demo operator has no vessel.");

  // ── Remove the previous run's fixtures ──────────────────────────────────
  const oldProducts = await db
    .select({ id: schema.products.id })
    .from(schema.products)
    .where(and(eq(schema.products.operatorId, op.id), like(schema.products.displayName, "E2E %")));
  const productIds = oldProducts.map((p) => p.id);
  const oldBookings = await db
    .select({ id: schema.bookings.id })
    .from(schema.bookings)
    .where(and(eq(schema.bookings.operatorId, op.id), like(schema.bookings.confirmationCode, "E2E%")));
  const bookingIds = oldBookings.map((b) => b.id);
  const oldTrips = productIds.length
    ? await db.select({ id: schema.trips.id }).from(schema.trips).where(inArray(schema.trips.productId, productIds))
    : [];
  const tripIds = oldTrips.map((t) => t.id);

  await db.delete(schema.stripeCommands).where(like(schema.stripeCommands.targetId, "pi_e2e_%"));
  if (bookingIds.length) {
    await db.delete(schema.checkIns).where(
      inArray(
        schema.checkIns.ticketId,
        db.select({ id: schema.tickets.id }).from(schema.tickets).where(inArray(schema.tickets.bookingId, bookingIds)),
      ),
    );
    await db.delete(schema.capacityChanges).where(inArray(schema.capacityChanges.bookingId, bookingIds));
    await db.delete(schema.tickets).where(inArray(schema.tickets.bookingId, bookingIds));
    await db.delete(schema.payments).where(inArray(schema.payments.bookingId, bookingIds));
    await db.delete(schema.bookingItems).where(inArray(schema.bookingItems.bookingId, bookingIds));
    await db.delete(schema.bookings).where(inArray(schema.bookings.id, bookingIds));
  }
  if (tripIds.length) {
    await db.delete(schema.capacityChanges).where(inArray(schema.capacityChanges.tripId, tripIds));
    await db.delete(schema.trips).where(inArray(schema.trips.id, tripIds));
  }
  if (productIds.length) {
    await db.delete(schema.productPrices).where(inArray(schema.productPrices.productId, productIds));
    await db.delete(schema.products).where(inArray(schema.products.id, productIds));
  }

  // ── Create this run's fixtures ──────────────────────────────────────────
  const date = e2eTripDate();

  async function tripWithPaidBooking(product: string, hourUtc: number, code: string, tickets: number) {
    const [p] = await db
      .insert(schema.products)
      .values({ operatorId: op.id, vesselId: vessel.id, category: "E2E", displayName: product })
      .returning({ id: schema.products.id });
    await db.insert(schema.productPrices).values({ productId: p.id, ticketType: "adult", priceCents: PRICE_CENTS });
    const [trip] = await db
      .insert(schema.trips)
      .values({
        operatorId: op.id,
        scheduleId: null,
        productId: p.id,
        vesselId: vessel.id,
        departureDate: date,
        startTime: new Date(`${date}T${String(hourUtc).padStart(2, "0")}:00:00Z`),
        endTime: new Date(`${date}T${String(hourUtc + 4).padStart(2, "0")}:00:00Z`),
        capacity: 20,
        seatsRemaining: 20 - tickets,
        status: "scheduled",
      })
      .returning({ id: schema.trips.id });
    const pi = `pi_e2e_${code.toLowerCase()}`;
    const total = PRICE_CENTS * tickets;
    const [booking] = await db
      .insert(schema.bookings)
      .values({
        operatorId: op.id,
        confirmationCode: code,
        status: "confirmed",
        totalCents: total,
        platformFeeCents: 150 * tickets,
        customerName: `${product} Customer`,
        customerEmail: `${code.toLowerCase()}@example.com`,
        stripePaymentIntentId: pi,
      })
      .returning({ id: schema.bookings.id });
    const [item] = await db
      .insert(schema.bookingItems)
      .values({ bookingId: booking.id, tripId: trip.id, operatorId: op.id, subtotalCents: total })
      .returning({ id: schema.bookingItems.id });
    for (let n = 0; n < tickets; n++) {
      const id = randomUUID();
      await db.insert(schema.tickets).values({
        id,
        bookingItemId: item.id,
        bookingId: booking.id,
        operatorId: op.id,
        ticketType: "adult",
        priceCents: PRICE_CENTS,
        listPriceCents: PRICE_CENTS,
        status: "live",
        qrPayload: id,
      });
    }
    await db.insert(schema.payments).values({
      bookingId: booking.id,
      operatorId: op.id,
      stripePaymentIntentId: pi,
      amountCents: total,
      applicationFeeCents: 150 * tickets,
      status: "succeeded",
    });
    return { bookingId: booking.id, pi };
  }

  const refund = await tripWithPaidBooking(E2E_REFUND_PRODUCT, 12, "E2EREF", 2);
  await tripWithPaidBooking(E2E_CANCEL_PRODUCT, 17, "E2ECAN", 1);

  // A refund Stripe refused, for the Money page's "Needs attention" list.
  await db.insert(schema.stripeCommands).values({
    id: randomUUID(),
    operatorId: op.id,
    kind: "refund",
    bookingId: refund.bookingId,
    reason: "admin_ticket_refund",
    targetId: refund.pi,
    amountCents: 1234,
    params: {},
    status: "failed",
    attempts: 1,
    lastError: `StripeInvalidRequestError (amount_too_large): ${E2E_REFUSED_NOTE}`,
  });

  console.log(`E2E admin fixtures ready on ${date}: "${E2E_REFUND_PRODUCT}", "${E2E_CANCEL_PRODUCT}", one refused refund.`);
  await client.end();
}

// Run only when executed directly, so the spec can import the names.
if (process.argv[1]?.endsWith("seed-e2e-admin.ts")) {
  run().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
