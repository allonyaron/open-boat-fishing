import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { seedOperator, cleanupOperator, testDb } from "../db-helpers";
import type { SeedResult } from "../db-helpers";
import { operators, trips, bookings, bookingItems, tickets } from "@openboat/db";
import { eq, inArray } from "drizzle-orm";
import { randomUUID } from "crypto";

vi.mock("@/lib/stripe", () => ({
  stripe: {
    paymentIntents: {
      create: vi.fn(),
    },
  },
}));

import { stripe } from "@/lib/stripe";
import { POST, GET } from "@/app/api/bookings/route";

let ctx: SeedResult;
let ipCounter = 0;

// Each test gets its own IP to avoid cross-test rate-limit state.
function nextIp() {
  return `10.0.${Math.floor(ipCounter / 255)}.${ipCounter++ % 255 + 1}`;
}

function postReq(body: unknown, operatorId?: string, ip?: string) {
  const req = new NextRequest("http://localhost/api/bookings", {
    method: "POST",
    body: JSON.stringify(body),
    headers: {
      "Content-Type": "application/json",
      ...(operatorId ? { "x-operator-id": operatorId } : {}),
      "x-forwarded-for": ip ?? nextIp(),
    },
  });
  return req;
}

function getReq(params: Record<string, string>, operatorId?: string) {
  const url = new URL("http://localhost/api/bookings");
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return new NextRequest(url, {
    headers: {
      ...(operatorId ? { "x-operator-id": operatorId } : {}),
      "x-forwarded-for": nextIp(),
    },
  });
}

const mockPi = { id: "pi_test_mock", client_secret: "pi_test_mock_secret_test" };

beforeAll(async () => {
  ctx = await seedOperator();
  // Give the operator a fake Stripe account so the route doesn't 500 early.
  await testDb
    .update(operators)
    .set({ stripeAccountId: "acct_test_fake", stripeOnboardingComplete: true })
    .where(eq(operators.id, ctx.operatorId));
});

afterAll(async () => {
  await cleanupOperator(ctx.operatorId);
});

beforeEach(() => {
  vi.mocked(stripe.paymentIntents.create).mockResolvedValue(mockPi as any);
});

// ---------------------------------------------------------------------------
// POST /api/bookings — validation
// ---------------------------------------------------------------------------

describe("POST /api/bookings — validation", () => {
  it("returns 400 for missing body", async () => {
    const res = await POST(postReq(null, ctx.operatorId));
    expect(res.status).toBe(400);
  });

  it("returns 400 for empty cart", async () => {
    const res = await POST(
      postReq({ customerEmail: "a@b.com", cart: [] }, ctx.operatorId),
    );
    expect(res.status).toBe(400);
  });

  it("returns 400 for invalid email", async () => {
    const res = await POST(
      postReq(
        { customerEmail: "not-an-email", cart: [{ tripId: randomUUID(), tickets: [{ ticketType: "adult", quantity: 1 }] }] },
        ctx.operatorId,
      ),
    );
    expect(res.status).toBe(400);
  });

  it("returns 400 for non-UUID tripId", async () => {
    const res = await POST(
      postReq(
        { customerEmail: "a@b.com", cart: [{ tripId: "not-a-uuid", tickets: [{ ticketType: "adult", quantity: 1 }] }] },
        ctx.operatorId,
      ),
    );
    expect(res.status).toBe(400);
  });

  it("returns 400 for cart item with no tickets", async () => {
    const res = await POST(
      postReq(
        { customerEmail: "a@b.com", cart: [{ tripId: randomUUID(), tickets: [] }] },
        ctx.operatorId,
      ),
    );
    expect(res.status).toBe(400);
  });

  it("returns 400 for ticket quantity 0", async () => {
    const res = await POST(
      postReq(
        { customerEmail: "a@b.com", cart: [{ tripId: randomUUID(), tickets: [{ ticketType: "adult", quantity: 0 }] }] },
        ctx.operatorId,
      ),
    );
    expect(res.status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// POST /api/bookings — operator / config errors
// ---------------------------------------------------------------------------

describe("POST /api/bookings — operator errors", () => {
  it("returns 500 when no operator header", async () => {
    const res = await POST(
      postReq({ customerEmail: "a@b.com", cart: [{ tripId: ctx.tripId, tickets: [{ ticketType: "adult", quantity: 1 }] }] }),
    );
    expect(res.status).toBe(500);
  });

  it("returns 500 when operator has no Stripe account", async () => {
    // Temporarily clear stripeAccountId
    await testDb
      .update(operators)
      .set({ stripeAccountId: null })
      .where(eq(operators.id, ctx.operatorId));

    const res = await POST(
      postReq(
        { customerEmail: "a@b.com", cart: [{ tripId: ctx.tripId, tickets: [{ ticketType: "adult", quantity: 1 }] }] },
        ctx.operatorId,
      ),
    );
    expect(res.status).toBe(500);

    await testDb
      .update(operators)
      .set({ stripeAccountId: "acct_test_fake" })
      .where(eq(operators.id, ctx.operatorId));
  });
});

// ---------------------------------------------------------------------------
// POST /api/bookings — seat / inventory errors
// ---------------------------------------------------------------------------

describe("POST /api/bookings — seat / inventory errors", () => {
  it("returns 404 when tripId does not exist", async () => {
    const res = await POST(
      postReq(
        { customerEmail: "a@b.com", cart: [{ tripId: randomUUID(), tickets: [{ ticketType: "adult", quantity: 1 }] }] },
        ctx.operatorId,
      ),
    );
    expect(res.status).toBe(404);
  });

  it("returns 409 when requested seats exceed seatsRemaining", async () => {
    await testDb
      .update(trips)
      .set({ seatsRemaining: 1 })
      .where(eq(trips.id, ctx.tripId));

    const res = await POST(
      postReq(
        { customerEmail: "a@b.com", cart: [{ tripId: ctx.tripId, tickets: [{ ticketType: "adult", quantity: 2 }] }] },
        ctx.operatorId,
      ),
    );
    expect(res.status).toBe(409);

    await testDb.update(trips).set({ seatsRemaining: 20 }).where(eq(trips.id, ctx.tripId));
  });

  it("returns 400 when no price exists for the requested ticket type", async () => {
    const res = await POST(
      postReq(
        { customerEmail: "a@b.com", cart: [{ tripId: ctx.tripId, tickets: [{ ticketType: "senior", quantity: 1 }] }] },
        ctx.operatorId,
      ),
    );
    // No "senior" price in seed data — route throws 400 from findPrice
    expect(res.status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// POST /api/bookings — happy path
// ---------------------------------------------------------------------------

describe("POST /api/bookings — success", () => {
  let createdBookingId: string;

  afterAll(async () => {
    // Clean up bookings created in this suite
    if (createdBookingId) {
      const items = await testDb
        .select({ id: bookingItems.id })
        .from(bookingItems)
        .where(eq(bookingItems.bookingId, createdBookingId));
      const itemIds = items.map((i) => i.id);
      if (itemIds.length) {
        await testDb.delete(tickets).where(inArray(tickets.bookingItemId, itemIds));
      }
      await testDb.delete(bookingItems).where(eq(bookingItems.bookingId, createdBookingId));
      await testDb.delete(bookings).where(eq(bookings.id, createdBookingId));
    }
    await testDb.update(trips).set({ seatsRemaining: 20 }).where(eq(trips.id, ctx.tripId));
  });

  it("creates a booking and returns clientSecret + booking fields", async () => {
    const res = await POST(
      postReq(
        {
          customerEmail: "buyer@example.com",
          customerName: "Buyer One",
          cart: [{ tripId: ctx.tripId, tickets: [{ ticketType: "adult", quantity: 2 }] }],
        },
        ctx.operatorId,
      ),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.clientSecret).toBe(mockPi.client_secret);
    expect(body.bookingId).toBeDefined();
    expect(body.confirmationCode).toMatch(/^[A-F0-9]{6}$/);
    expect(body.totalCents).toBe(20000); // 2 × $100
    expect(body.ticketCount).toBe(2);
    expect(body.groupDiscountCents).toBe(0);
    expect(body.holdExpiresAt).toBeDefined();
    createdBookingId = body.bookingId;
  });

  it("decrements seatsRemaining on the trip", async () => {
    const [trip] = await testDb
      .select({ seatsRemaining: trips.seatsRemaining })
      .from(trips)
      .where(eq(trips.id, ctx.tripId));
    // 2 seats were booked in the previous test
    expect(trip.seatsRemaining).toBe(18);
  });

  it("persists booking, bookingItem, and tickets in the DB", async () => {
    const [booking] = await testDb
      .select()
      .from(bookings)
      .where(eq(bookings.id, createdBookingId));
    expect(booking.status).toBe("pending");
    expect(booking.customerEmail).toBe("buyer@example.com");
    expect(booking.totalCents).toBe(20000);
    expect(booking.platformFeeCents).toBe(300); // 2 × $1.50

    const items = await testDb
      .select()
      .from(bookingItems)
      .where(eq(bookingItems.bookingId, createdBookingId));
    expect(items).toHaveLength(1);

    const ticketRows = await testDb
      .select()
      .from(tickets)
      .where(eq(tickets.bookingId, createdBookingId));
    expect(ticketRows).toHaveLength(2);
    expect(ticketRows.every((t) => t.ticketType === "adult")).toBe(true);
    expect(ticketRows.every((t) => t.priceCents === 10000)).toBe(true);
    expect(ticketRows.every((t) => t.feeAmountCents === 150)).toBe(true);
    expect(ticketRows.every((t) => t.feeStatus === "held")).toBe(true);
  });

  it("records the Stripe PI id on the booking", async () => {
    const [booking] = await testDb
      .select({ stripePaymentIntentId: bookings.stripePaymentIntentId })
      .from(bookings)
      .where(eq(bookings.id, createdBookingId));
    expect(booking.stripePaymentIntentId).toBe(mockPi.id);
  });

  it("sets holdExpiresAt ~60 min out when seats are plentiful", async () => {
    const [booking] = await testDb
      .select({ holdExpiresAt: bookings.holdExpiresAt })
      .from(bookings)
      .where(eq(bookings.id, createdBookingId));
    const diffMin = (booking.holdExpiresAt!.getTime() - Date.now()) / 60_000;
    // Should be close to 60 min (between 55 and 65 to account for test timing)
    expect(diffMin).toBeGreaterThan(55);
    expect(diffMin).toBeLessThan(65);
  });
});

// ---------------------------------------------------------------------------
// POST /api/bookings — near-full hold window
// ---------------------------------------------------------------------------

describe("POST /api/bookings — near-full trip hold window", () => {
  let nearFullBookingId: string;

  beforeAll(async () => {
    // Set seatsRemaining to 3 (< 4 threshold for near-full)
    await testDb.update(trips).set({ seatsRemaining: 3 }).where(eq(trips.id, ctx.tripId));
  });

  afterAll(async () => {
    if (nearFullBookingId) {
      const items = await testDb
        .select({ id: bookingItems.id })
        .from(bookingItems)
        .where(eq(bookingItems.bookingId, nearFullBookingId));
      const itemIds = items.map((i) => i.id);
      if (itemIds.length) {
        await testDb.delete(tickets).where(inArray(tickets.bookingItemId, itemIds));
      }
      await testDb.delete(bookingItems).where(eq(bookingItems.bookingId, nearFullBookingId));
      await testDb.delete(bookings).where(eq(bookings.id, nearFullBookingId));
    }
    await testDb.update(trips).set({ seatsRemaining: 20 }).where(eq(trips.id, ctx.tripId));
  });

  it("sets holdExpiresAt ~10 min out when trip is near-full", async () => {
    const res = await POST(
      postReq(
        {
          customerEmail: "nearfull@example.com",
          cart: [{ tripId: ctx.tripId, tickets: [{ ticketType: "adult", quantity: 1 }] }],
        },
        ctx.operatorId,
      ),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    nearFullBookingId = body.bookingId;

    const [booking] = await testDb
      .select({ holdExpiresAt: bookings.holdExpiresAt })
      .from(bookings)
      .where(eq(bookings.id, nearFullBookingId));
    const diffMin = (booking.holdExpiresAt!.getTime() - Date.now()) / 60_000;
    expect(diffMin).toBeGreaterThan(8);
    expect(diffMin).toBeLessThan(12);
  });
});

// ---------------------------------------------------------------------------
// POST /api/bookings — Stripe failure rollback
// ---------------------------------------------------------------------------

describe("POST /api/bookings — Stripe PI failure rollback", () => {
  it("restores seats and cancels booking when Stripe throws", async () => {
    vi.mocked(stripe.paymentIntents.create).mockRejectedValueOnce(
      new Error("Stripe connection refused"),
    );

    const [before] = await testDb
      .select({ seatsRemaining: trips.seatsRemaining })
      .from(trips)
      .where(eq(trips.id, ctx.tripId));

    const res = await POST(
      postReq(
        {
          customerEmail: "stripe-fail@example.com",
          cart: [{ tripId: ctx.tripId, tickets: [{ ticketType: "adult", quantity: 1 }] }],
        },
        ctx.operatorId,
      ),
    );
    expect(res.status).toBe(502);

    const [after] = await testDb
      .select({ seatsRemaining: trips.seatsRemaining })
      .from(trips)
      .where(eq(trips.id, ctx.tripId));
    // Seats must be restored
    expect(after.seatsRemaining).toBe(before.seatsRemaining);
  });
});

// ---------------------------------------------------------------------------
// GET /api/bookings — wallet lookup
// ---------------------------------------------------------------------------

describe("GET /api/bookings — wallet lookup", () => {
  let confirmedBookingId: string;
  let confirmedCode: string;
  const confirmedEmail = `wallet-${randomUUID().slice(0, 6)}@example.com`;

  beforeAll(async () => {
    // Seed a confirmed booking for lookup tests
    const code = randomUUID().slice(0, 6).toUpperCase();
    confirmedCode = code;
    const [booking] = await testDb
      .insert(bookings)
      .values({
        operatorId: ctx.operatorId,
        confirmationCode: code,
        status: "confirmed",
        totalCents: 10000,
        platformFeeCents: 150,
        customerEmail: confirmedEmail,
        holdExpiresAt: new Date(Date.now() + 3_600_000),
        stripePaymentIntentId: `pi_test_${randomUUID().slice(0, 8)}`,
      })
      .returning({ id: bookings.id });
    confirmedBookingId = booking.id;

    const [item] = await testDb
      .insert(bookingItems)
      .values({ bookingId: confirmedBookingId, tripId: ctx.tripId, operatorId: ctx.operatorId, subtotalCents: 10000 })
      .returning({ id: bookingItems.id });

    await testDb.insert(tickets).values({
      bookingItemId: item.id,
      bookingId: confirmedBookingId,
      operatorId: ctx.operatorId,
      ticketType: "adult",
      priceCents: 10000,
      feeAmountCents: 150,
      qrPayload: randomUUID(),
    });
  });

  afterAll(async () => {
    const items = await testDb
      .select({ id: bookingItems.id })
      .from(bookingItems)
      .where(eq(bookingItems.bookingId, confirmedBookingId));
    const itemIds = items.map((i) => i.id);
    if (itemIds.length) {
      await testDb.delete(tickets).where(inArray(tickets.bookingItemId, itemIds));
    }
    await testDb.delete(bookingItems).where(eq(bookingItems.bookingId, confirmedBookingId));
    await testDb.delete(bookings).where(eq(bookings.id, confirmedBookingId));
  });

  it("returns 400 when email is missing", async () => {
    const res = await GET(getReq({ code: confirmedCode }));
    expect(res.status).toBe(400);
  });

  it("returns 400 when code is missing", async () => {
    const res = await GET(getReq({ email: confirmedEmail }));
    expect(res.status).toBe(400);
  });

  it("returns 404 for wrong code", async () => {
    const res = await GET(getReq({ email: confirmedEmail, code: "ZZZZZZ" }));
    expect(res.status).toBe(404);
  });

  it("returns 404 for wrong email", async () => {
    const res = await GET(getReq({ email: "wrong@example.com", code: confirmedCode }));
    expect(res.status).toBe(404);
  });

  it("returns 404 for a pending (not confirmed) booking", async () => {
    const pendingCode = randomUUID().slice(0, 6).toUpperCase();
    const pendingEmail = `pending-${randomUUID().slice(0, 6)}@example.com`;
    const [b] = await testDb
      .insert(bookings)
      .values({
        operatorId: ctx.operatorId,
        confirmationCode: pendingCode,
        status: "pending",
        totalCents: 10000,
        platformFeeCents: 150,
        customerEmail: pendingEmail,
        holdExpiresAt: new Date(Date.now() + 3_600_000),
      })
      .returning({ id: bookings.id });

    const res = await GET(getReq({ email: pendingEmail, code: pendingCode }));
    expect(res.status).toBe(404);

    await testDb.delete(bookings).where(eq(bookings.id, b.id));
  });

  it("returns full booking detail for a confirmed booking", async () => {
    const res = await GET(getReq({ email: confirmedEmail, code: confirmedCode }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.id).toBe(confirmedBookingId);
    expect(body.confirmationCode).toBe(confirmedCode);
    expect(body.customerEmail).toBe(confirmedEmail);
    expect(body.totalCents).toBe(10000);
    expect(Array.isArray(body.items)).toBe(true);
    expect(body.items).toHaveLength(1);
    const item = body.items[0];
    expect(item.trip.vessel.id).toBe(ctx.vesselId);
    expect(item.tickets).toHaveLength(1);
    expect(item.tickets[0].ticketType).toBe("adult");
  });
});
