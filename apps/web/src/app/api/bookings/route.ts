import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { stripe } from "@/lib/stripe";
import {
  operators,
  vessels,
  products,
  trips,
  bookings,
  bookingItems,
  tickets,
  productPrices,
  schedulePrices,
} from "@openboat/db";
import { and, eq, inArray, sql } from "drizzle-orm";
import { randomBytes, randomUUID } from "crypto";

const PLATFORM_FEE_CENTS = 150; // $1.50 per ticket

// --- wallet lookup rate limiting ---
const WINDOW_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 5;
const MIN_RESPONSE_MS = 150; // floor prevents email-existence timing oracle

const rlStore = new Map<string, { count: number; windowStart: number; lockedUntil?: number }>();

setInterval(
  () => {
    const now = Date.now();
    for (const [key, entry] of rlStore.entries()) {
      if (now > (entry.lockedUntil ?? 0) && now - entry.windowStart > WINDOW_MS) {
        rlStore.delete(key);
      }
    }
  },
  30 * 60 * 1000,
).unref();

function rlCheck(key: string): { allowed: boolean; retryAfterMs: number } {
  const now = Date.now();
  const entry = rlStore.get(key);
  if (entry?.lockedUntil && now < entry.lockedUntil) {
    return { allowed: false, retryAfterMs: entry.lockedUntil - now };
  }
  if (!entry || now - entry.windowStart > WINDOW_MS) {
    rlStore.set(key, { count: 1, windowStart: now });
    return { allowed: true, retryAfterMs: 0 };
  }
  if (entry.count >= MAX_ATTEMPTS) {
    const lockedUntil = now + WINDOW_MS;
    rlStore.set(key, { ...entry, lockedUntil });
    return { allowed: false, retryAfterMs: WINDOW_MS };
  }
  entry.count++;
  return { allowed: true, retryAfterMs: 0 };
}

function rlReset(key: string) {
  rlStore.delete(key);
}

async function enforceMinDelay(startMs: number) {
  const elapsed = Date.now() - startMs;
  if (elapsed < MIN_RESPONSE_MS) {
    await new Promise((r) => setTimeout(r, MIN_RESPONSE_MS - elapsed));
  }
}
// --- end rate limiting ---

function confirmationCode() {
  return randomBytes(3).toString("hex").toUpperCase();
}

type CartItem = {
  tripId: string;
  tickets: { ticketType: "adult" | "child" | "senior"; quantity: number }[];
};

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { cart, customerName, customerEmail, customerPhone } = body as {
    cart: CartItem[];
    customerName?: string | null;
    customerEmail: string;
    customerPhone?: string;
  };

  if (!cart?.length || !customerEmail) {
    return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
  }

  const [operator] = await db.select().from(operators).limit(1);
  if (!operator) {
    return NextResponse.json({ error: "No operator configured" }, { status: 500 });
  }

  const tripIds = cart.map((c) => c.tripId);

  // Validate ticket types/quantities before touching the DB
  const seatRequestsByTrip: Record<string, number> = {};
  for (const item of cart) {
    for (const t of item.tickets) {
      if (!["adult", "child", "senior"].includes(t.ticketType)) {
        return NextResponse.json(
          { error: `Invalid ticket type: ${t.ticketType}` },
          { status: 400 },
        );
      }
      if (!Number.isInteger(t.quantity) || t.quantity <= 0) {
        return NextResponse.json(
          { error: "Ticket quantity must be a positive integer" },
          { status: 400 },
        );
      }
      seatRequestsByTrip[item.tripId] = (seatRequestsByTrip[item.tripId] ?? 0) + t.quantity;
    }
  }

  // All seat-sensitive work runs in one transaction. FOR UPDATE on trip rows
  // serializes concurrent bookings — the second request waits here until the
  // first commits, then reads the already-decremented seat count.
  let booking: typeof bookings.$inferSelect;
  let totalCents: number;
  let ticketCount: number;
  let groupDiscountCents: number;
  let holdExpiresAt: Date;

  try {
    ({ booking, totalCents, ticketCount, groupDiscountCents, holdExpiresAt } = await db.transaction(
      async (tx) => {
        const tripRows = await tx
          .select()
          .from(trips)
          .where(inArray(trips.id, tripIds))
          .for("update");

        if (tripRows.length !== tripIds.length) {
          throw Object.assign(new Error("One or more trips not found"), { httpStatus: 404 });
        }

        for (const trip of tripRows) {
          const requested = seatRequestsByTrip[trip.id] ?? 0;
          if (requested > (trip.seatsRemaining ?? 0)) {
            throw Object.assign(
              new Error(`Not enough seats available — only ${trip.seatsRemaining} left`),
              { httpStatus: 409 },
            );
          }
        }

        const productIds = [...new Set(tripRows.map((t) => t.productId))];
        const scheduleIds = [...new Set(tripRows.map((t) => t.scheduleId))];
        const vesselIds = [...new Set(tripRows.map((t) => t.vesselId))];

        const [productPriceRows, schedulePriceRows, vesselRows] = await Promise.all([
          tx.select().from(productPrices).where(inArray(productPrices.productId, productIds)),
          tx.select().from(schedulePrices).where(inArray(schedulePrices.scheduleId, scheduleIds)),
          tx.select().from(vessels).where(inArray(vessels.id, vesselIds)),
        ]);

        // Schedule-level price takes precedence over product-level price
        function findPrice(trip: (typeof tripRows)[0], ticketType: string) {
          return (
            schedulePriceRows.find(
              (p) => p.scheduleId === trip.scheduleId && p.ticketType === ticketType,
            ) ??
            productPriceRows.find(
              (p) => p.productId === trip.productId && p.ticketType === ticketType,
            )
          );
        }

        let totalCents = 0;
        let ticketCount = 0;

        // Count tickets per vessel to evaluate group discounts
        const ticketsByVessel: Record<string, number> = {};
        for (const item of cart) {
          const trip = tripRows.find((t) => t.id === item.tripId)!;
          const count = item.tickets.reduce((s, t) => s + t.quantity, 0);
          ticketsByVessel[trip.vesselId] = (ticketsByVessel[trip.vesselId] ?? 0) + count;
        }

        for (const item of cart) {
          const trip = tripRows.find((t) => t.id === item.tripId)!;
          for (const t of item.tickets) {
            const price = findPrice(trip, t.ticketType);
            if (!price) {
              throw Object.assign(
                new Error(`No price found for ${t.ticketType} on trip ${item.tripId}`),
                { httpStatus: 400 },
              );
            }
            totalCents += price.priceCents * t.quantity;
            ticketCount += t.quantity;
          }
        }

        // Apply group discount per vessel when threshold is met
        let groupDiscountCents = 0;
        for (const vessel of vesselRows) {
          const threshold = vessel.groupDiscountThreshold;
          const pct = vessel.groupDiscountPct;
          if (!threshold || !pct) continue;
          const count = ticketsByVessel[vessel.id] ?? 0;
          if (count < threshold) continue;

          // Discount applies only to tickets on this vessel
          let vesselSubtotal = 0;
          for (const item of cart) {
            const trip = tripRows.find((t) => t.id === item.tripId)!;
            if (trip.vesselId !== vessel.id) continue;
            for (const t of item.tickets) {
              const price = findPrice(trip, t.ticketType)!;
              vesselSubtotal += price.priceCents * t.quantity;
            }
          }
          groupDiscountCents += Math.round((vesselSubtotal * pct) / 100);
        }

        totalCents -= groupDiscountCents;
        const platformFeeCents = PLATFORM_FEE_CENTS * ticketCount;

        // Decrement seats now, while we hold the row locks
        for (const [tripId, count] of Object.entries(seatRequestsByTrip)) {
          await tx
            .update(trips)
            .set({ seatsRemaining: sql`${trips.seatsRemaining} - ${count}` })
            .where(eq(trips.id, tripId));
        }

        // Hold window: 10 min when any trip is near-full (<4 seats or <15% capacity),
        // 60 min otherwise (long enough that no countdown is shown).
        const nearFull = tripRows.some((trip) => {
          const requested = seatRequestsByTrip[trip.id] ?? 0;
          const afterDecrement = (trip.seatsRemaining ?? 0) - requested;
          return afterDecrement < 4 || afterDecrement / trip.capacity < 0.15;
        });
        const holdMinutes = nearFull ? 10 : 60;
        const holdExpiresAt = new Date(Date.now() + holdMinutes * 60 * 1000);

        const [booking] = await tx
          .insert(bookings)
          .values({
            operatorId: operator.id,
            confirmationCode: confirmationCode(),
            status: "pending",
            totalCents,
            platformFeeCents,
            groupDiscountCents,
            customerName: customerName ?? null,
            customerEmail,
            customerPhone,
            termsVersion: operator.termsUrl ?? "unversioned",
            termsAcceptedAt: new Date(),
            holdExpiresAt,
          })
          .returning();

        for (const item of cart) {
          const trip = tripRows.find((t) => t.id === item.tripId)!;
          const vessel = vesselRows.find((v) => v.id === trip.vesselId)!;
          const rawSubtotal = item.tickets.reduce((s, t) => {
            const price = findPrice(trip, t.ticketType)!;
            return s + price.priceCents * t.quantity;
          }, 0);
          // Pro-rate group discount across items by their share of the vessel subtotal
          const vesselSubtotal = cart
            .filter((ci) => tripRows.find((t) => t.id === ci.tripId)!.vesselId === trip.vesselId)
            .reduce((s, ci) => {
              const cTrip = tripRows.find((t) => t.id === ci.tripId)!;
              return (
                s +
                ci.tickets.reduce((ss, t) => {
                  const p = findPrice(cTrip, t.ticketType)!;
                  return ss + p.priceCents * t.quantity;
                }, 0)
              );
            }, 0);
          const threshold = vessel.groupDiscountThreshold;
          const pct = vessel.groupDiscountPct;
          const itemDiscount =
            threshold && pct && (ticketsByVessel[vessel.id] ?? 0) >= threshold && vesselSubtotal > 0
              ? Math.round(
                  (rawSubtotal / vesselSubtotal) * Math.round((vesselSubtotal * pct) / 100),
                )
              : 0;

          const [bookingItem] = await tx
            .insert(bookingItems)
            .values({
              bookingId: booking.id,
              tripId: item.tripId,
              operatorId: operator.id,
              subtotalCents: rawSubtotal - itemDiscount,
            })
            .returning();

          const ticketValues = item.tickets.flatMap((t) => {
            const price = findPrice(trip, t.ticketType)!;
            return Array.from({ length: t.quantity }, () => {
              const id = randomUUID();
              return {
                id,
                bookingItemId: bookingItem.id,
                bookingId: booking.id,
                operatorId: operator.id,
                ticketType: t.ticketType,
                priceCents: price.priceCents,
                feeAmountCents: PLATFORM_FEE_CENTS,
                feeStatus: "held" as const,
                qrPayload: id,
              };
            });
          });

          if (ticketValues.length > 0) {
            await tx.insert(tickets).values(ticketValues);
          }
        }

        return { booking, totalCents, ticketCount, groupDiscountCents, holdExpiresAt };
      },
    ));
  } catch (err: unknown) {
    const status = (err as { httpStatus?: number }).httpStatus;
    if (status) {
      return NextResponse.json({ error: (err as Error).message }, { status });
    }
    throw err;
  }

  // Stripe PI creation is outside the transaction. If it fails, restore seats
  // and cancel the booking so no ghost holds accumulate.
  let paymentIntent;
  try {
    const connectedAccountId = process.env.STRIPE_CONNECTED_ACCOUNT_ID!;
    paymentIntent = await stripe.paymentIntents.create({
      amount: totalCents,
      currency: "usd",
      automatic_payment_methods: { enabled: true },
      transfer_data: { destination: connectedAccountId },
      application_fee_amount: booking.platformFeeCents,
      metadata: {
        bookingId: booking.id,
        operatorId: operator.id,
        confirmationCode: booking.confirmationCode,
      },
    });
  } catch (err) {
    await db.transaction(async (tx) => {
      for (const [tripId, count] of Object.entries(seatRequestsByTrip)) {
        await tx
          .update(trips)
          .set({ seatsRemaining: sql`${trips.seatsRemaining} + ${count}` })
          .where(eq(trips.id, tripId));
      }
      await tx.update(bookings).set({ status: "cancelled" }).where(eq(bookings.id, booking.id));
    });
    console.error("Stripe PaymentIntent creation failed, booking cancelled:", err);
    return NextResponse.json({ error: "Payment service unavailable" }, { status: 502 });
  }

  await db
    .update(bookings)
    .set({ stripePaymentIntentId: paymentIntent.id })
    .where(eq(bookings.id, booking.id));

  return NextResponse.json({
    clientSecret: paymentIntent.client_secret,
    bookingId: booking.id,
    confirmationCode: booking.confirmationCode,
    totalCents,
    ticketCount,
    groupDiscountCents,
    holdExpiresAt: holdExpiresAt.toISOString(),
  });
}

// GET /api/bookings?email=<email>&code=<confirmationCode>
// Requires both params — code alone is guessable (16.7M combos); the pair is not.
// Returns only confirmed bookings with full trip/vessel/product detail for the
// mobile SQLite wallet cache.
export async function GET(req: NextRequest) {
  const start = Date.now();

  const { searchParams } = new URL(req.url);
  const email = searchParams.get("email")?.toLowerCase().trim();
  const code = searchParams.get("code")?.toUpperCase().trim();

  if (!email || !code) {
    return NextResponse.json({ error: "Missing email or code" }, { status: 400 });
  }

  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  const emailKey = `email:${email}`;
  const ipKey = `ip:${ip}`;

  const emailCheck = rlCheck(emailKey);
  const ipCheck = rlCheck(ipKey);

  if (!emailCheck.allowed || !ipCheck.allowed) {
    const retryAfterSec = Math.ceil(Math.max(emailCheck.retryAfterMs, ipCheck.retryAfterMs) / 1000);
    await enforceMinDelay(start);
    return NextResponse.json(
      { error: "Too many attempts. Try again later." },
      { status: 429, headers: { "Retry-After": String(retryAfterSec) } },
    );
  }

  const [booking] = await db
    .select()
    .from(bookings)
    .where(
      and(
        eq(bookings.customerEmail, email),
        eq(bookings.confirmationCode, code),
        eq(bookings.status, "confirmed"),
      ),
    );

  if (!booking) {
    await enforceMinDelay(start);
    return NextResponse.json({ error: "Booking not found" }, { status: 404 });
  }

  rlReset(emailKey);
  rlReset(ipKey);

  const itemRows = await db
    .select()
    .from(bookingItems)
    .where(eq(bookingItems.bookingId, booking.id));

  const tripIds = itemRows.map((i) => i.tripId);

  const [ticketRows, tripRows] = await Promise.all([
    db.select().from(tickets).where(eq(tickets.bookingId, booking.id)),
    tripIds.length > 0
      ? db.select().from(trips).where(inArray(trips.id, tripIds))
      : Promise.resolve([] as (typeof trips.$inferSelect)[]),
  ]);

  const vesselIds = [...new Set(tripRows.map((t) => t.vesselId))];
  const productIds = [...new Set(tripRows.map((t) => t.productId))];

  const [vesselRows, productRows] = await Promise.all([
    vesselIds.length > 0
      ? db.select().from(vessels).where(inArray(vessels.id, vesselIds))
      : Promise.resolve([] as (typeof vessels.$inferSelect)[]),
    productIds.length > 0
      ? db.select().from(products).where(inArray(products.id, productIds))
      : Promise.resolve([] as (typeof products.$inferSelect)[]),
  ]);

  const items = itemRows.map((item) => {
    const trip = tripRows.find((t) => t.id === item.tripId)!;
    const vessel = vesselRows.find((v) => v.id === trip.vesselId)!;
    const product = productRows.find((p) => p.id === trip.productId)!;
    const itemTickets = ticketRows.filter((t) => t.bookingItemId === item.id);

    return {
      id: item.id,
      tripId: item.tripId,
      subtotalCents: item.subtotalCents,
      trip: {
        id: trip.id,
        startTime: trip.startTime,
        endTime: trip.endTime,
        departureDate: trip.departureDate,
        boardingTime: trip.boardingTime,
        status: trip.status,
        vessel: {
          id: vessel.id,
          name: vessel.name,
          color: vessel.color,
        },
        product: {
          id: product.id,
          displayName: product.displayName,
          category: product.category,
        },
      },
      tickets: itemTickets.map((t) => ({
        id: t.id,
        ticketType: t.ticketType,
        priceCents: t.priceCents,
        feeAmountCents: t.feeAmountCents,
        qrPayload: t.qrPayload,
        voided: t.voided,
      })),
    };
  });

  return NextResponse.json({
    id: booking.id,
    confirmationCode: booking.confirmationCode,
    customerName: booking.customerName,
    customerEmail: booking.customerEmail,
    customerPhone: booking.customerPhone,
    totalCents: booking.totalCents,
    groupDiscountCents: booking.groupDiscountCents,
    createdAt: booking.createdAt,
    items,
  });
}
