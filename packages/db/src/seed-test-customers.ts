/**
 * Seeds 10 test bookings on today's first scheduled trip.
 * Run after seed-test-trip.ts.
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
// Date-based prefix so codes don't conflict across re-seeds on different days
const D = today.replace(/-/g, "").slice(4); // e.g. "0805"

type TicketType = "adult" | "child" | "senior";

const CUSTOMERS: {
  name: string;
  email: string;
  phone: string;
  code: string;
  tickets: { type: TicketType; cents: number }[];
}[] = [
  {
    name: "Maria Garcia",
    email: "maria.garcia@gmail.com",
    phone: "5162223333",
    code: `${D}02`,
    tickets: [
      { type: "adult", cents: 6800 },
      { type: "adult", cents: 6800 },
      { type: "child", cents: 5000 },
    ],
  },
  {
    name: "Robert Chen",
    email: "rchen@outlook.com",
    phone: "5163334444",
    code: `${D}03`,
    tickets: [{ type: "adult", cents: 6800 }],
  },
  {
    name: "Patricia Johnson",
    email: "pjohnson@yahoo.com",
    phone: "5164445555",
    code: `${D}04`,
    tickets: [
      { type: "adult", cents: 6800 },
      { type: "senior", cents: 6200 },
    ],
  },
  {
    name: "James Williams",
    email: "jwilliams@gmail.com",
    phone: "5165556666",
    code: `${D}05`,
    tickets: [
      { type: "adult", cents: 6800 },
      { type: "adult", cents: 6800 },
      { type: "adult", cents: 6800 },
      { type: "child", cents: 5000 },
    ],
  },
  {
    name: "Linda Martinez",
    email: "linda.m@icloud.com",
    phone: "5166667777",
    code: `${D}06`,
    tickets: [
      { type: "adult", cents: 6800 },
      { type: "child", cents: 5000 },
      { type: "child", cents: 5000 },
    ],
  },
  {
    name: "Michael Brown",
    email: "mbrown@gmail.com",
    phone: "5167778888",
    code: `${D}07`,
    tickets: [{ type: "adult", cents: 6800 }],
  },
  {
    name: "Barbara Davis",
    email: "bdavis@hotmail.com",
    phone: "5168889999",
    code: `${D}08`,
    tickets: [
      { type: "senior", cents: 6200 },
      { type: "senior", cents: 6200 },
    ],
  },
  {
    name: "William Anderson",
    email: "wanderson@gmail.com",
    phone: "5169990000",
    code: `${D}09`,
    tickets: [
      { type: "adult", cents: 6800 },
      { type: "adult", cents: 6800 },
    ],
  },
  {
    name: "Susan Taylor",
    email: "staylor@aol.com",
    phone: "5160001111",
    code: `${D}10`,
    tickets: [{ type: "adult", cents: 6800 }],
  },
  {
    name: "David Thomas",
    email: "dthomas@gmail.com",
    phone: "5161112222",
    code: `${D}11`,
    tickets: [
      { type: "adult", cents: 6800 },
      { type: "child", cents: 5000 },
    ],
  },
];

async function run() {
  const [op] = await db.select().from(schema.operators).limit(1);
  if (!op) throw new Error("No operator");

  const [trip] = await db
    .select()
    .from(schema.trips)
    .where(
      and(
        eq(schema.trips.departureDate, today),
        eq(schema.trips.operatorId, op.id),
        eq(schema.trips.status, "scheduled"),
      ),
    )
    .limit(1);

  if (!trip)
    throw new Error(`No scheduled trip found for today (${today}). Run seed-test-trip.ts first.`);

  console.log(`Adding bookings to trip ${trip.id} (${today})`);

  let ticketCount = 0;

  for (const c of CUSTOMERS) {
    // Skip if confirmation code already exists
    const [existing] = await db
      .select({ id: schema.bookings.id })
      .from(schema.bookings)
      .where(eq(schema.bookings.confirmationCode, c.code));
    if (existing) {
      console.log(`  skipping ${c.code} — already exists`);
      continue;
    }

    const subtotal = c.tickets.reduce((s, t) => s + t.cents, 0);
    const fee = c.tickets.length * 150;

    const [booking] = await db
      .insert(schema.bookings)
      .values({
        operatorId: op.id,
        confirmationCode: c.code,
        status: "confirmed",
        totalCents: subtotal + fee,
        platformFeeCents: fee,
        customerName: c.name,
        customerEmail: c.email,
        customerPhone: c.phone,
      })
      .returning();

    const [item] = await db
      .insert(schema.bookingItems)
      .values({
        bookingId: booking.id,
        tripId: trip.id,
        operatorId: op.id,
        subtotalCents: subtotal,
      })
      .returning();

    await db.insert(schema.tickets).values(
      c.tickets.map((t) => {
        const id = crypto.randomUUID();
        return {
          id,
          bookingItemId: item.id,
          bookingId: booking.id,
          operatorId: op.id,
          ticketType: t.type,
          priceCents: t.cents,
          feeAmountCents: 150,
          qrPayload: id,
        };
      }),
    );

    ticketCount += c.tickets.length;
    console.log(`  ✓ ${c.code}  ${c.name.padEnd(20)} — ${c.tickets.map((t) => t.type).join(", ")}`);
  }

  // Update seats remaining
  await db
    .update(schema.trips)
    .set({
      seatsRemaining: Math.max(0, trip.seatsRemaining - ticketCount),
      updatedAt: new Date(),
    })
    .where(eq(schema.trips.id, trip.id));

  console.log(
    `\nDone — ${ticketCount} tickets added. Refresh the mate app to see the full manifest.`,
  );
  await client.end();
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
