import { NextRequest, NextResponse } from "next/server";
import { trips } from "@openboat/db";
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { getOperatorContext, getOperatorId } from "@/lib/operator";
import { checkRateLimit, clientIp, tooManyRequests } from "@/lib/rate-limit";
import { assertCartBookable, cartSchema } from "@/lib/bookings/cart";
import { loadPriceBook } from "@/lib/bookings/price-book";
import { priceCart } from "@/lib/bookings/price-cart";

// The cart rail and checkout re-quote as the cart changes, so this allows far
// more than booking-create's 20 per 15 min. It reads only.
const QUOTE_RATE_WINDOW_MS = 15 * 60 * 1000;
const QUOTE_RATE_MAX = 300;

const quoteBodySchema = z.object({ cart: cartSchema });

// POST /api/bookings/quote — what a cart costs, from the same priceCart that
// POST /api/bookings charges with (P8-3). Holds no seats and writes nothing.
// Clients show this total and pass it to Stripe Elements; the booking's own
// totalCents is still the amount charged.
export async function POST(req: NextRequest) {
  const opId = getOperatorId(req) ?? "unknown";
  const rl = await checkRateLimit(`booking-quote:${opId}:${clientIp(req)}`, QUOTE_RATE_MAX, QUOTE_RATE_WINDOW_MS);
  if (!rl.allowed) return tooManyRequests(rl.retryAfterSec);

  const parsed = quoteBodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request", details: parsed.error.flatten().fieldErrors },
      { status: 400 },
    );
  }
  const { cart } = parsed.data;

  const operator = await getOperatorContext(req);
  if (!operator) {
    return NextResponse.json({ error: "No operator configured" }, { status: 500 });
  }

  const tripRows = await db
    .select()
    .from(trips)
    .where(and(inArray(trips.id, cart.map((c) => c.tripId)), eq(trips.operatorId, operator.id)));

  try {
    assertCartBookable(cart, tripRows, operator.onlineCutoffMinutes, new Date(), { checkSeats: false });
    const priced = priceCart(cart, tripRows, await loadPriceBook(operator.id, tripRows));
    return NextResponse.json({
      lines: priced.lines.map((l) => ({
        tripId: l.tripId,
        fares: l.fares,
        listCents: l.listCents,
        discountCents: l.discountCents,
        totalCents: l.netCents,
      })),
      listCents: priced.listCents,
      discountCents: priced.discountCents,
      totalCents: priced.totalCents,
      ticketCount: priced.ticketCount,
    });
  } catch (err: unknown) {
    const status = (err as { httpStatus?: number }).httpStatus;
    if (status) return NextResponse.json({ error: (err as Error).message }, { status });
    throw err;
  }
}
