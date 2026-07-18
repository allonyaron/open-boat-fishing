import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { stripe } from "@/lib/stripe";
import { operators, trips, bookings, bookingItems, tickets, productPrices } from "@openboat/db";
import { eq, inArray } from "drizzle-orm";
import { randomBytes, randomUUID } from "crypto";

const PLATFORM_FEE_CENTS = 150; // $1.50 per ticket

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
    customerName: string;
    customerEmail: string;
    customerPhone?: string;
  };

  if (!cart?.length || !customerName || !customerEmail) {
    return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
  }

  const [operator] = await db.select().from(operators).limit(1);
  if (!operator) {
    return NextResponse.json({ error: "No operator configured" }, { status: 500 });
  }

  const tripIds = cart.map((c) => c.tripId);
  const tripRows = await db.select().from(trips).where(inArray(trips.id, tripIds));

  if (tripRows.length !== tripIds.length) {
    return NextResponse.json({ error: "One or more trips not found" }, { status: 404 });
  }

  // Validate quantities and check seat availability
  const seatRequestsByTrip: Record<string, number> = {};
  for (const item of cart) {
    for (const t of item.tickets) {
      if (!["adult", "child", "senior"].includes(t.ticketType)) {
        return NextResponse.json({ error: `Invalid ticket type: ${t.ticketType}` }, { status: 400 });
      }
      if (!Number.isInteger(t.quantity) || t.quantity <= 0) {
        return NextResponse.json({ error: "Ticket quantity must be a positive integer" }, { status: 400 });
      }
      seatRequestsByTrip[item.tripId] = (seatRequestsByTrip[item.tripId] ?? 0) + t.quantity;
    }
  }
  for (const trip of tripRows) {
    const requested = seatRequestsByTrip[trip.id] ?? 0;
    if (requested > (trip.seatsRemaining ?? 0)) {
      return NextResponse.json(
        { error: `Not enough seats available — only ${trip.seatsRemaining} left` },
        { status: 409 }
      );
    }
  }

  const productIds = [...new Set(tripRows.map((t) => t.productId))];
  const priceRows = await db
    .select()
    .from(productPrices)
    .where(inArray(productPrices.productId, productIds));

  // Calculate total
  let totalCents = 0;
  let ticketCount = 0;

  for (const item of cart) {
    const trip = tripRows.find((t) => t.id === item.tripId)!;
    for (const ticket of item.tickets) {
      const price = priceRows.find(
        (p) => p.productId === trip.productId && p.ticketType === ticket.ticketType
      );
      if (!price) {
        return NextResponse.json(
          { error: `No price found for ${ticket.ticketType} on trip ${item.tripId}` },
          { status: 400 }
        );
      }
      totalCents += price.priceCents * ticket.quantity;
      ticketCount += ticket.quantity;
    }
  }

  const platformFeeCents = PLATFORM_FEE_CENTS * ticketCount;

  // Create pending booking
  const [booking] = await db
    .insert(bookings)
    .values({
      operatorId: operator.id,
      confirmationCode: confirmationCode(),
      status: "pending",
      totalCents,
      platformFeeCents,
      customerName,
      customerEmail,
      customerPhone,
    })
    .returning();

  // Create booking items + tickets (one ticket row per passenger)
  for (const item of cart) {
    const trip = tripRows.find((t) => t.id === item.tripId)!;
    const subtotal = item.tickets.reduce((s, t) => {
      const price = priceRows.find(
        (p) => p.productId === trip.productId && p.ticketType === t.ticketType
      )!;
      return s + price.priceCents * t.quantity;
    }, 0);

    const [bookingItem] = await db
      .insert(bookingItems)
      .values({
        bookingId: booking.id,
        tripId: item.tripId,
        operatorId: operator.id,
        subtotalCents: subtotal,
      })
      .returning();

    const ticketValues = item.tickets.flatMap((t) => {
      const price = priceRows.find(
        (p) => p.productId === trip.productId && p.ticketType === t.ticketType
      )!;
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
      await db.insert(tickets).values(ticketValues);
    }
  }

  // Create Stripe PaymentIntent routed to the connected account
  const connectedAccountId = process.env.STRIPE_CONNECTED_ACCOUNT_ID!;
  const paymentIntent = await stripe.paymentIntents.create({
    amount: totalCents,
    currency: "usd",
    transfer_data: { destination: connectedAccountId },
    application_fee_amount: platformFeeCents,
    metadata: {
      bookingId: booking.id,
      operatorId: operator.id,
      confirmationCode: booking.confirmationCode,
    },
  });

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
  });
}
