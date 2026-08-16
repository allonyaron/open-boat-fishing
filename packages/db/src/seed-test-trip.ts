/**
 * Seeds a test trip for today + a booking with 2 tickets so the mate app
 * has something to check in against. Safe to re-run.
 *
 * Usage:
 *   cd packages/db && DATABASE_URL=... tsx src/seed-test-trip.ts
 */
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "./schema.js";
import { eq, and } from "drizzle-orm";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) throw new Error("DATABASE_URL is not set");

const client = postgres(DATABASE_URL);
const db = drizzle(client, { schema });

const today = new Date().toISOString().slice(0, 10);

async function run() {
  const [op] = await db.select().from(schema.operators).limit(1);
  if (!op) throw new Error("No operator");

  // Find any trip for today (including cancelled) to restore, or find a schedule to use
  const [existingTrip] = await db
    .select()
    .from(schema.trips)
    .where(and(eq(schema.trips.departureDate, today), eq(schema.trips.operatorId, op.id)))
    .limit(1);

  let tripId: string;

  if (existingTrip) {
    // Restore it to scheduled for testing
    await db
      .update(schema.trips)
      .set({
        status: "scheduled",
        cancelledAt: null,
        cancellationReason: null,
        seatsRemaining: existingTrip.capacity,
        updatedAt: new Date(),
      })
      .where(eq(schema.trips.id, existingTrip.id));
    tripId = existingTrip.id;
    console.log(`✓ Restored trip ${existingTrip.id} (${today}) to scheduled`);
  } else {
    // Find a vessel + product + schedule to create from scratch
    const [vessel] = await db
      .select()
      .from(schema.vessels)
      .where(eq(schema.vessels.operatorId, op.id))
      .limit(1);
    const [product] = await db
      .select()
      .from(schema.products)
      .where(eq(schema.products.vesselId, vessel.id))
      .limit(1);
    const [schedule] = await db
      .select()
      .from(schema.schedules)
      .where(eq(schema.schedules.productId, product.id))
      .limit(1);

    const startTime = new Date(`${today}T11:00:00Z`);
    const endTime = new Date(`${today}T16:00:00Z`);

    const [trip] = await db
      .insert(schema.trips)
      .values({
        operatorId: op.id,
        scheduleId: schedule.id,
        productId: product.id,
        vesselId: vessel.id,
        departureDate: today,
        startTime,
        endTime,
        capacity: 29,
        seatsRemaining: 29,
        status: "scheduled",
      })
      .returning();
    tripId = trip.id;
    console.log(`✓ Created trip ${trip.id} for ${today}`);
  }

  // Check if a test booking already exists for this trip
  const existingItems = await db
    .select()
    .from(schema.bookingItems)
    .where(eq(schema.bookingItems.tripId, tripId));

  if (existingItems.length > 0) {
    console.log(`✓ Test booking already exists for this trip — skipping booking seed`);

    // Show ticket QR payloads for scanner testing
    const ticketRows = await db
      .select({
        id: schema.tickets.id,
        type: schema.tickets.ticketType,
        qr: schema.tickets.qrPayload,
      })
      .from(schema.tickets)
      .where(eq(schema.tickets.bookingItemId, existingItems[0].id));
    console.log("\nTickets to scan (paste qrPayload into keyboard scan):");
    console.table(ticketRows);
    await client.end();
    return;
  }

  // Use a unique code so re-running across different dates doesn't conflict
  const code = `MT${today.replace(/-/g, "").slice(4)}`; // e.g. MT0805

  // Seed a test booking
  const [booking] = await db
    .insert(schema.bookings)
    .values({
      operatorId: op.id,
      confirmationCode: code,
      status: "confirmed",
      totalCents: 13600,
      platformFeeCents: 300,
      customerName: "John Doe",
      customerEmail: "john@example.com",
      customerPhone: "5165551234",
    })
    .returning();

  const [bookingItem] = await db
    .insert(schema.bookingItems)
    .values({
      bookingId: booking.id,
      tripId,
      operatorId: op.id,
      subtotalCents: 13600,
    })
    .returning();

  // Insert adult + child tickets
  const adultId = crypto.randomUUID();
  const childId = crypto.randomUUID();

  await db.insert(schema.tickets).values([
    {
      id: adultId,
      bookingItemId: bookingItem.id,
      bookingId: booking.id,
      operatorId: op.id,
      ticketType: "adult",
      priceCents: 6800,
      feeAmountCents: 150,
      qrPayload: adultId,
    },
    {
      id: childId,
      bookingItemId: bookingItem.id,
      bookingId: booking.id,
      operatorId: op.id,
      ticketType: "child",
      priceCents: 6800,
      feeAmountCents: 150,
      qrPayload: childId,
    },
  ]);

  // Update seats
  await db
    .update(schema.trips)
    .set({ seatsRemaining: 27, updatedAt: new Date() })
    .where(eq(schema.trips.id, tripId));

  console.log(`✓ Booking MATE01 created (John Doe — Adult + Child)`);
  console.log("\nTickets to scan (paste qrPayload into keyboard scan):");
  console.table([
    { type: "adult", qrPayload: adultId },
    { type: "child", qrPayload: childId },
  ]);

  await client.end();
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
