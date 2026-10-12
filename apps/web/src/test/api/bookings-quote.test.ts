import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { and, eq } from "drizzle-orm";
import { bookingItems, bookings, operators, schedulePrices, tickets, trips, vessels } from "@openboat/db";
import { seedOperator, setTripDeparture, cleanupOperator, testDb } from "../db-helpers";
import type { SeedResult } from "../db-helpers";

vi.mock("@/lib/stripe", () => ({
  stripe: { paymentIntents: { create: vi.fn() } },
}));

import { stripe } from "@/lib/stripe";
import { POST as quote } from "@/app/api/bookings/quote/route";
import { POST as book } from "@/app/api/bookings/route";

let ctx: SeedResult;
let other: SeedResult;
let oneOffTripId: string;
let ipCounter = 0;

function req(path: string, body: unknown, operatorId = ctx.operatorId) {
  return new NextRequest(`http://localhost${path}`, {
    method: "POST",
    body: JSON.stringify(body),
    headers: {
      "Content-Type": "application/json",
      "x-operator-id": operatorId,
      "x-forwarded-for": `10.9.0.${++ipCounter}`,
    },
  });
}

beforeAll(async () => {
  ctx = await seedOperator();
  other = await seedOperator();
  await testDb
    .update(operators)
    .set({ stripeAccountId: "acct_test_fake", stripeOnboardingComplete: true })
    .where(eq(operators.id, ctx.operatorId));
  const startTime = await setTripDeparture(ctx.tripId, 3 * 3_600_000);
  await setTripDeparture(other.tripId, 3 * 3_600_000);

  // A one-off departure (no schedule) on the same vessel, so a cart can span
  // two trips with different pricing.
  const [oneOff] = await testDb
    .insert(trips)
    .values({
      operatorId: ctx.operatorId,
      scheduleId: null,
      vesselId: ctx.vesselId,
      productId: ctx.productId,
      departureDate: startTime.toISOString().slice(0, 10),
      startTime: new Date(startTime.getTime() + 3_600_000),
      endTime: new Date(startTime.getTime() + 9 * 3_600_000),
      capacity: 20,
      seatsRemaining: 20,
      status: "scheduled",
    })
    .returning({ id: trips.id });
  oneOffTripId = oneOff.id;
});

afterEach(async () => {
  // A booking here can span both trips, so delete by operator, children first.
  await testDb.delete(tickets).where(eq(tickets.operatorId, ctx.operatorId));
  await testDb.delete(bookingItems).where(eq(bookingItems.operatorId, ctx.operatorId));
  await testDb.delete(bookings).where(eq(bookings.operatorId, ctx.operatorId));
  await testDb.update(trips).set({ seatsRemaining: 20 }).where(eq(trips.operatorId, ctx.operatorId));
  await testDb.delete(schedulePrices).where(eq(schedulePrices.operatorId, ctx.operatorId));
  await testDb
    .update(vessels)
    .set({ groupDiscountThreshold: null, groupDiscountPct: null })
    .where(eq(vessels.id, ctx.vesselId));
  vi.mocked(stripe.paymentIntents.create).mockReset();
});

afterAll(async () => {
  await cleanupOperator(ctx.operatorId);
  await cleanupOperator(other.operatorId);
});

describe("POST /api/bookings/quote", () => {
  it("prices a cart at list price", async () => {
    const res = await quote(
      req("/api/bookings/quote", {
        cart: [{ tripId: ctx.tripId, tickets: [{ ticketType: "adult", quantity: 2 }, { ticketType: "child", quantity: 1 }] }],
      }),
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toEqual({
      lines: [
        {
          tripId: ctx.tripId,
          fares: [
            { ticketType: "adult", quantity: 2, unitListCents: 10000, listCents: 20000 },
            { ticketType: "child", quantity: 1, unitListCents: 6000, listCents: 6000 },
          ],
          listCents: 26000,
          discountCents: 0,
          totalCents: 26000,
        },
      ],
      listCents: 26000,
      discountCents: 0,
      totalCents: 26000,
      ticketCount: 3,
    });
  });

  it("quotes exactly what the booking charges: schedule price, group discount, two trips", async () => {
    await testDb.insert(schedulePrices).values({
      scheduleId: ctx.scheduleId,
      operatorId: ctx.operatorId,
      ticketType: "adult",
      priceCents: 4950,
    });
    await testDb
      .update(vessels)
      .set({ groupDiscountThreshold: 3, groupDiscountPct: 10 })
      .where(eq(vessels.id, ctx.vesselId));
    vi.mocked(stripe.paymentIntents.create).mockResolvedValue({ id: "pi_quote", client_secret: "pi_quote_secret" } as never);

    const cart = [
      { tripId: ctx.tripId, tickets: [{ ticketType: "adult", quantity: 2 }] },
      { tripId: oneOffTripId, tickets: [{ ticketType: "child", quantity: 1 }] },
    ];
    const quoted = await (await quote(req("/api/bookings/quote", { cart }))).json();
    // $49.50 × 2 (schedule override) + $60 (product fare, no schedule) = $159; 10% off = $15.90.
    expect(quoted.listCents).toBe(15900);
    expect(quoted.discountCents).toBe(1590);
    expect(quoted.totalCents).toBe(14310);
    expect(quoted.lines.reduce((s: number, l: { totalCents: number }) => s + l.totalCents, 0)).toBe(14310);

    const booked = await book(
      req("/api/bookings", { cart, customerEmail: "quote@test.com", customerName: "Quote Test" }),
    );
    expect(booked.status).toBe(200);
    const data = await booked.json();
    expect(data.totalCents).toBe(quoted.totalCents);
    expect(data.groupDiscountCents).toBe(quoted.discountCents);

    const piArgs = vi.mocked(stripe.paymentIntents.create).mock.calls[0][0]!;
    expect(piArgs.amount).toBe(quoted.totalCents);
    expect(piArgs.application_fee_amount).toBe(3 * 150);

    // The stored line subtotals add up to the charge (no penny drift).
    const items = await testDb.select().from(bookingItems).where(eq(bookingItems.bookingId, data.bookingId));
    expect(items.reduce((s, i) => s + i.subtotalCents, 0)).toBe(quoted.totalCents);
    for (const line of quoted.lines) {
      expect(items.find((i) => i.tripId === line.tripId)!.subtotalCents).toBe(line.totalCents);
    }
  });

  it("holds no seats and writes no booking", async () => {
    const before = await testDb.select().from(trips).where(eq(trips.id, ctx.tripId));
    const res = await quote(
      req("/api/bookings/quote", { cart: [{ tripId: ctx.tripId, tickets: [{ ticketType: "adult", quantity: 5 }] }] }),
    );
    expect(res.status).toBe(200);
    const after = await testDb.select().from(trips).where(eq(trips.id, ctx.tripId));
    expect(after[0].seatsRemaining).toBe(before[0].seatsRemaining);
    const rows = await testDb.select().from(bookings).where(eq(bookings.operatorId, ctx.operatorId));
    expect(rows).toHaveLength(0);
  });

  it("leaves seat counts to the booking (expired holds aren't reclaimed here)", async () => {
    await testDb.update(trips).set({ seatsRemaining: 1 }).where(eq(trips.id, ctx.tripId));
    const res = await quote(
      req("/api/bookings/quote", { cart: [{ tripId: ctx.tripId, tickets: [{ ticketType: "adult", quantity: 3 }] }] }),
    );
    expect(res.status).toBe(200);
  });

  it("returns 404 for another operator's trip", async () => {
    const res = await quote(
      req("/api/bookings/quote", { cart: [{ tripId: other.tripId, tickets: [{ ticketType: "adult", quantity: 1 }] }] }),
    );
    expect(res.status).toBe(404);
  });

  it("returns 409 for a trip that is no longer scheduled", async () => {
    await testDb.update(trips).set({ status: "cancelled" }).where(eq(trips.id, oneOffTripId));
    try {
      const res = await quote(
        req("/api/bookings/quote", { cart: [{ tripId: oneOffTripId, tickets: [{ ticketType: "adult", quantity: 1 }] }] }),
      );
      expect(res.status).toBe(409);
    } finally {
      await testDb.update(trips).set({ status: "scheduled" }).where(eq(trips.id, oneOffTripId));
    }
  });

  it("returns 400 for a fare the trip doesn't sell", async () => {
    const res = await quote(
      req("/api/bookings/quote", { cart: [{ tripId: ctx.tripId, tickets: [{ ticketType: "senior", quantity: 1 }] }] }),
    );
    expect(res.status).toBe(400);
  });

  it("returns 400 for an invalid cart", async () => {
    const res = await quote(req("/api/bookings/quote", { cart: [] }));
    expect(res.status).toBe(400);
  });

  it("ignores an out-of-bounds vessel discount, in the quote and the charge alike (P7-5)", async () => {
    await testDb
      .update(vessels)
      .set({ groupDiscountThreshold: 2, groupDiscountPct: 150 })
      .where(and(eq(vessels.id, ctx.vesselId), eq(vessels.operatorId, ctx.operatorId)));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.mocked(stripe.paymentIntents.create).mockResolvedValue({ id: "pi_q2", client_secret: "pi_q2_secret" } as never);
    const cart = [{ tripId: ctx.tripId, tickets: [{ ticketType: "adult", quantity: 2 }] }];

    const quoted = await (await quote(req("/api/bookings/quote", { cart }))).json();
    expect(quoted.totalCents).toBe(20000);
    const booked = await (await book(req("/api/bookings", { cart, customerEmail: "p75@test.com" }))).json();
    expect(booked.totalCents).toBe(20000);
    warn.mockRestore();
  });
});
