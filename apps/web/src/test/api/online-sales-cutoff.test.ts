// P2-1: departed trips — and trips past their online-sales cutoff — can't be
// booked or listed. The booking route (JS check under the trip lock) and the
// trip list (SQL filter) must agree on the same boundary:
//   open ⇔ now < startTime − cutoff
// Date is frozen so "exactly at the cutoff" is exact. Only Date is faked: the
// route's min-response delay and the pg client still need real timers.
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { seedOperator, cleanupOperator, testDb } from "../db-helpers";
import type { SeedResult } from "../db-helpers";
import { operators, trips, bookings } from "@openboat/db";
import { eq } from "drizzle-orm";

vi.mock("@/lib/stripe", () => ({
  stripe: { paymentIntents: { create: vi.fn() } },
}));

import { stripe } from "@/lib/stripe";
import { POST } from "@/app/api/bookings/route";
import { GET } from "@/app/api/trips/route";

const MIN = 60_000;
// Fixed instant mid-month, so every trip's departureDate falls in one month.
const NOW = new Date("2026-07-15T16:00:00.000Z");
const MONTH = "2026-07";
const DEFAULT_CUTOFF = 30; // operators.online_cutoff_minutes default

let ctx: SeedResult;
let ipCounter = 0;

beforeAll(async () => {
  ctx = await seedOperator();
  await testDb
    .update(operators)
    .set({ stripeAccountId: "acct_test_fake", stripeOnboardingComplete: true })
    .where(eq(operators.id, ctx.operatorId));
});

afterAll(async () => {
  await cleanupOperator(ctx.operatorId);
});

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  // stripe_payment_intent_id is unique, so each booking needs its own PI id.
  vi.mocked(stripe.paymentIntents.create).mockImplementation(async () => {
    const id = `pi_test_cutoff_${++ipCounter}`;
    return { id, client_secret: `${id}_secret` } as never;
  });
});

afterEach(() => {
  vi.useRealTimers();
});

/** A one-off trip leaving `offsetMs` from NOW. Times are instants, never ET strings. */
async function tripLeavingIn(offsetMs: number, onlineCutoffMinutes: number | null = null) {
  const startTime = new Date(NOW.getTime() + offsetMs);
  const [trip] = await testDb
    .insert(trips)
    .values({
      operatorId: ctx.operatorId,
      scheduleId: null,
      vesselId: ctx.vesselId,
      productId: ctx.productId,
      departureDate: startTime.toISOString().slice(0, 10),
      startTime,
      endTime: new Date(startTime.getTime() + 8 * 60 * MIN),
      capacity: 20,
      seatsRemaining: 20,
      status: "scheduled",
      onlineCutoffMinutes,
    })
    .returning({ id: trips.id, startTime: trips.startTime });
  return trip;
}

function book(tripId: string) {
  return POST(
    new NextRequest("http://localhost/api/bookings", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-operator-id": ctx.operatorId,
        "x-forwarded-for": `10.21.0.${++ipCounter}`,
      },
      body: JSON.stringify({
        customerEmail: "cutoff@example.com",
        cart: [{ tripId, tickets: [{ ticketType: "adult", quantity: 1 }] }],
      }),
    }),
  );
}

async function listedTripIds(): Promise<string[]> {
  const url = new URL("http://localhost/api/trips");
  url.searchParams.set("month", MONTH);
  const res = await GET(new NextRequest(url, { headers: { "x-operator-id": ctx.operatorId } }));
  expect(res.status).toBe(200);
  return ((await res.json()) as { id: string }[]).map((t) => t.id);
}

async function expectClosed(tripId: string) {
  const res = await book(tripId);
  expect(res.status).toBe(409);
  expect((await res.json()).error).toMatch(/online sales/i);
  expect(await listedTripIds()).not.toContain(tripId);
  const [trip] = await testDb.select().from(trips).where(eq(trips.id, tripId));
  expect(trip.seatsRemaining).toBe(20); // nothing held
}

async function expectOpen(tripId: string) {
  expect(await listedTripIds()).toContain(tripId);
  const res = await book(tripId);
  expect(res.status).toBe(200);
  return (await res.json()) as { bookingId: string; holdExpiresAt: string };
}

describe("online sales cutoff (P2-1) — operator default", () => {
  it("rejects and hides a trip that has already departed", async () => {
    const trip = await tripLeavingIn(-60 * MIN);
    await expectClosed(trip.id);
  });

  it("rejects and hides a trip departing in the next few minutes", async () => {
    const trip = await tripLeavingIn(5 * MIN);
    await expectClosed(trip.id);
  });

  it("rejects and hides a trip exactly at the cutoff", async () => {
    const trip = await tripLeavingIn(DEFAULT_CUTOFF * MIN);
    await expectClosed(trip.id);
  });

  it("sells a trip one second before the cutoff", async () => {
    const trip = await tripLeavingIn(DEFAULT_CUTOFF * MIN + 1000);
    await expectOpen(trip.id);
  });

  it("follows a changed operator default", async () => {
    await testDb.update(operators).set({ onlineCutoffMinutes: 90 }).where(eq(operators.id, ctx.operatorId));
    try {
      const trip = await tripLeavingIn(60 * MIN); // open under 30, closed under 90
      await expectClosed(trip.id);
    } finally {
      await testDb
        .update(operators)
        .set({ onlineCutoffMinutes: DEFAULT_CUTOFF })
        .where(eq(operators.id, ctx.operatorId));
    }
  });
});

describe("online sales cutoff (P2-1) — per-trip override", () => {
  it("a longer override closes sales that the default would allow", async () => {
    const trip = await tripLeavingIn(60 * MIN, 120);
    await expectClosed(trip.id);
  });

  it("a zero override sells right up to departure, and the hold ends at departure", async () => {
    const trip = await tripLeavingIn(5 * MIN, 0);
    const body = await expectOpen(trip.id);
    // A booking started before the cutoff may finish, but not after the boat leaves.
    expect(new Date(body.holdExpiresAt).getTime()).toBe(trip.startTime.getTime());
    const [booking] = await testDb.select().from(bookings).where(eq(bookings.id, body.bookingId));
    expect(booking.holdExpiresAt!.getTime()).toBe(trip.startTime.getTime());
  });

  it("a zero override still rejects a trip exactly at departure", async () => {
    const trip = await tripLeavingIn(0, 0);
    await expectClosed(trip.id);
  });
});
