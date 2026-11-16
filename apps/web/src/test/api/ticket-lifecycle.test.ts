// Blocker 7 (P3-1(d)): a ticket boards, counts as sold and earns its fee only
// once it is live, and every path that takes it out of service moves it
// through lib/tickets exactly once.
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { randomUUID } from "crypto";
import { seedOperator, cleanupOperator, seedBooking, cleanupBookings, testDb } from "../db-helpers";
import type { SeedResult } from "../db-helpers";
import { bookings, payments, tickets, trips } from "@openboat/db";
import { eq } from "drizzle-orm";

vi.mock("@/lib/stripe", () => ({
  stripe: {
    paymentIntents: {
      retrieve: vi.fn().mockResolvedValue({ status: "requires_payment_method" }),
      cancel: vi.fn().mockResolvedValue({ status: "canceled" }),
    },
    charges: { retrieve: vi.fn() },
    refunds: { create: vi.fn().mockResolvedValue({ id: "re_test" }) },
    applicationFees: { createRefund: vi.fn().mockResolvedValue({ id: "fr_test" }) },
  },
}));
vi.mock("@/lib/email", () => ({ sendBookingConfirmation: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@/lib/push", () => ({ sendPushToEmails: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@/lib/session", () => ({ requireAdmin: vi.fn() }));

import { requireAdmin } from "@/lib/session";
import { handlePaymentIntentSucceeded } from "@/lib/webhooks/payment-intent-succeeded";
import { handlePaymentIntentCanceled } from "@/lib/webhooks/payment-intent-canceled";
import { handleChargeRefunded } from "@/lib/webhooks/charge-refunded";
import { settleTrips } from "@/lib/settle-trips";

let ctx: SeedResult;

beforeAll(async () => {
  ctx = await seedOperator();
});

afterAll(async () => {
  await cleanupOperator(ctx.operatorId);
});

beforeEach(() => {
  vi.mocked(requireAdmin).mockResolvedValue({
    session: { staffId: ctx.staffId, operatorId: ctx.operatorId, role: "admin" as const, name: "Admin" },
  } as any);
});

afterEach(async () => {
  await cleanupBookings(ctx.tripId);
  await testDb.update(trips).set({ status: "scheduled" }).where(eq(trips.id, ctx.tripId));
});

async function ticket(id: string) {
  const [row] = await testDb
    .select({ status: tickets.status, voided: tickets.voided, feeStatus: tickets.feeStatus })
    .from(tickets)
    .where(eq(tickets.id, id));
  return row;
}

async function seatsRemaining() {
  const [row] = await testDb
    .select({ seatsRemaining: trips.seatsRemaining })
    .from(trips)
    .where(eq(trips.id, ctx.tripId));
  return row.seatsRemaining;
}

async function setSeats(n: number) {
  await testDb.update(trips).set({ seatsRemaining: n }).where(eq(trips.id, ctx.tripId));
}

/** A second ticket on a seeded booking's item. */
async function addTicket(bookingId: string, bookingItemId: string, status: "held" | "live") {
  const id = randomUUID();
  await testDb.insert(tickets).values({
    id,
    bookingItemId,
    bookingId,
    operatorId: ctx.operatorId,
    ticketType: "adult",
    priceCents: 10000,
    feeAmountCents: 150,
    status,
    qrPayload: id,
  });
  return id;
}

async function addPayment(bookingId: string, piId: string) {
  await testDb.insert(payments).values({
    bookingId,
    operatorId: ctx.operatorId,
    stripePaymentIntentId: piId,
    amountCents: 10000,
    applicationFeeCents: 150,
    status: "succeeded",
  });
}

function pi(overrides: Record<string, unknown>) {
  return {
    id: `pi_${randomUUID().slice(0, 8)}`,
    amount: 10000,
    status: "succeeded",
    payment_method_types: ["card"],
    latest_charge: null,
    metadata: {},
    ...overrides,
  } as any;
}

describe("an unpaid hold that ends", () => {
  it("expiry cron voids the held ticket, reverses its fee and gives the seat back", async () => {
    await setSeats(19);
    const { ticketId } = await seedBooking(ctx, { holdExpiresAt: new Date(Date.now() - 60_000) });

    const { GET } = await import("@/app/api/cron/expire-pending-bookings/route");
    await GET(
      new NextRequest("http://localhost/api/cron/expire-pending-bookings", {
        headers: { Authorization: `Bearer ${process.env.CRON_SECRET}` },
      }),
    );

    expect(await ticket(ticketId)).toEqual({ status: "voided", voided: true, feeStatus: "reversed" });
    expect(await seatsRemaining()).toBe(20);
  });

  it("payment_intent.canceled voids the held ticket", async () => {
    await setSeats(19);
    const { bookingId, ticketId } = await seedBooking(ctx);

    await handlePaymentIntentCanceled(pi({ status: "canceled", metadata: { bookingId } }));

    expect(await ticket(ticketId)).toEqual({ status: "voided", voided: true, feeStatus: "reversed" });
    expect(await seatsRemaining()).toBe(20);
  });

  it("a ticket a cancelled trip already voided isn't given back twice", async () => {
    await setSeats(20);
    const { bookingId } = await seedBooking(ctx, { ticketStatus: "voided" });

    await handlePaymentIntentCanceled(pi({ status: "canceled", metadata: { bookingId } }));

    expect(await seatsRemaining()).toBe(20);
  });
});

describe("payment_intent.succeeded", () => {
  it("makes held tickets live, once", async () => {
    const { bookingId, ticketId } = await seedBooking(ctx, { holdExpiresAt: new Date(Date.now() + 600_000) });
    const event = pi({ metadata: { bookingId } });

    await handlePaymentIntentSucceeded(event);
    expect(await ticket(ticketId)).toEqual({ status: "live", voided: false, feeStatus: "held" });

    await handlePaymentIntentSucceeded(event);
    expect((await ticket(ticketId)).status).toBe("live");
  });

  it("doesn't bring back a ticket that was voided while the booking was pending", async () => {
    const { bookingId, ticketId } = await seedBooking(ctx, {
      ticketStatus: "voided",
      holdExpiresAt: new Date(Date.now() + 600_000),
    });

    await handlePaymentIntentSucceeded(pi({ metadata: { bookingId } }));

    expect(await ticket(ticketId)).toEqual({ status: "voided", voided: true, feeStatus: "reversed" });
  });
});

describe("boarding", () => {
  it("mate check-in rejects an unpaid ticket with the code installed builds know", async () => {
    const { ticketId } = await seedBooking(ctx);
    const { POST } = await import("@/app/api/mate/checkins/route");

    const res = await POST(
      new NextRequest("http://localhost/api/mate/checkins", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${ctx.mateToken}` },
        body: JSON.stringify({
          events: [{ localId: "l1", ticketId, tripId: ctx.tripId, method: "qr", note: null, checkedInAt: new Date().toISOString() }],
        }),
      }),
    );

    expect((await res.json()).results).toEqual([{ localId: "l1", ok: false, error: "ticket_voided" }]);
  });

  describe("office check-in", () => {
    async function checkIn(ticketId: string) {
      const { POST } = await import("@/app/api/admin/trips/[tripId]/checkins/route");
      return POST(
        new NextRequest(`http://localhost/api/admin/trips/${ctx.tripId}/checkins`, {
          method: "POST",
          body: JSON.stringify({ ticketId, checkedIn: true }),
          headers: { "content-type": "application/json" },
        }),
        { params: { tripId: ctx.tripId } },
      );
    }

    it("refuses an unpaid ticket", async () => {
      const { ticketId } = await seedBooking(ctx);
      const res = await checkIn(ticketId);
      expect(res.status).toBe(409);
      expect((await res.json()).error).toMatch(/paid/);
    });

    it("refuses any ticket on a cancelled trip", async () => {
      const { ticketId } = await seedBooking(ctx, { status: "confirmed" });
      await testDb.update(trips).set({ status: "cancelled" }).where(eq(trips.id, ctx.tripId));
      const res = await checkIn(ticketId);
      expect(res.status).toBe(409);
      expect((await res.json()).error).toMatch(/cancelled/);
    });

    it("still takes a check-in after departure", async () => {
      const { ticketId } = await seedBooking(ctx, { status: "confirmed" });
      await testDb.update(trips).set({ status: "pending_settlement" }).where(eq(trips.id, ctx.tripId));
      const res = await checkIn(ticketId);
      expect(res.status).toBe(200);
    });
  });

  it("the mate manifest leaves unpaid holds out and marks refunded tickets voided", async () => {
    await seedBooking(ctx); // held
    const paid = await seedBooking(ctx, { status: "confirmed" });
    const refunded = await seedBooking(ctx, { status: "confirmed", ticketStatus: "refunded" });
    const { GET } = await import("@/app/api/mate/manifest/route");

    const res = await GET(
      new NextRequest(`http://localhost/api/mate/manifest?tripId=${ctx.tripId}`, {
        headers: { Authorization: `Bearer ${ctx.mateToken}` },
      }),
    );
    const body = await res.json();
    const listed = body.bookings.flatMap((b: { tickets: { id: string; status: string; voided: boolean }[] }) => b.tickets);

    expect(body.trip.ticketsSold).toBe(1);
    expect(listed).toHaveLength(2);
    expect(listed.find((t: { id: string }) => t.id === paid.ticketId)).toMatchObject({ status: "live", voided: false });
    expect(listed.find((t: { id: string }) => t.id === refunded.ticketId)).toMatchObject({ status: "refunded", voided: true });
  });
});

describe("fees", () => {
  it("settlement earns only live tickets, and revenue doesn't count a never-paid fee as reversed", async () => {
    const live = await seedBooking(ctx, { status: "confirmed" });
    const held = await seedBooking(ctx);
    const expired = await seedBooking(ctx, { status: "cancelled" });
    await seedBooking(ctx, { status: "confirmed", ticketStatus: "refunded" });
    // Departed four days ago: past the 48-hour grace window.
    const startTime = new Date(Date.now() - 4 * 24 * 3_600_000);
    await testDb
      .update(trips)
      .set({ status: "pending_settlement", startTime, endTime: new Date(startTime.getTime() + 8 * 3_600_000) })
      .where(eq(trips.id, ctx.tripId));

    await settleTrips(ctx.operatorId);

    expect((await ticket(live.ticketId)).feeStatus).toBe("earned");
    expect((await ticket(held.ticketId)).feeStatus).toBe("held");
    expect((await ticket(expired.ticketId)).feeStatus).toBe("reversed");

    const { GET } = await import("@/app/api/admin/revenue/route");
    const from = startTime.toISOString().slice(0, 10);
    const res = await GET(new NextRequest(`http://localhost/api/admin/revenue?from=${from}&to=2099-12-31`));
    const { totals } = await res.json();
    // Reversed counts the refunded ticket, not the expired hold's.
    expect(totals).toMatchObject({ earnedCount: 1, heldCount: 0, reversedCount: 1 });
  });
});

describe("seats come back once per ticket", () => {
  async function refundTicket(ticketId: string) {
    const { POST } = await import("@/app/api/admin/tickets/[ticketId]/refund/route");
    return POST(new NextRequest(`http://localhost/api/admin/tickets/${ticketId}/refund`, { method: "POST" }), {
      params: { ticketId },
    });
  }

  it("two refund submits for one ticket restore its seat once", async () => {
    await setSeats(19);
    const piId = `pi_${randomUUID().slice(0, 8)}`;
    const { bookingId, ticketId } = await seedBooking(ctx, { status: "confirmed", stripePaymentIntentId: piId });
    await addPayment(bookingId, piId);

    await Promise.all([refundTicket(ticketId), refundTicket(ticketId)]);

    expect(await ticket(ticketId)).toMatchObject({ status: "refunded", voided: true });
    expect(await seatsRemaining()).toBe(20);
  });

  it("a full refund after a one-ticket refund gives back only the rest", async () => {
    await setSeats(18);
    const piId = `pi_${randomUUID().slice(0, 8)}`;
    const { bookingId, bookingItemId, ticketId } = await seedBooking(ctx, {
      status: "confirmed",
      stripePaymentIntentId: piId,
    });
    const second = await addTicket(bookingId, bookingItemId, "live");
    await addPayment(bookingId, piId);

    await refundTicket(ticketId);
    expect(await seatsRemaining()).toBe(19);

    await handleChargeRefunded({ id: "ch_test", amount: 20000, amount_refunded: 20000, payment_intent: piId } as any);

    expect(await ticket(second)).toMatchObject({ status: "refunded", voided: true });
    expect(await seatsRemaining()).toBe(20);
    const [b] = await testDb.select({ status: bookings.status }).from(bookings).where(eq(bookings.id, bookingId));
    expect(b.status).toBe("cancelled");
  });
});
