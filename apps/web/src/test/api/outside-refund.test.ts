// Row 32: a partial refund the operator made in their own Stripe Dashboard is
// matched to tickets on the Money page. The office says which ticket it was:
// it is refunded without paying the customer again, its seat comes back and
// its platform fee goes back to the operator, never beyond what was refunded
// in Stripe.
import { randomUUID } from "crypto";
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { seedOperator, cleanupOperator, seedBooking, testDb, stripeTestCtx, auditRowsFor } from "../db-helpers";
import type { SeedResult } from "../db-helpers";
import { bookings, payments, stripeCommands, stripeEvents, tickets, trips } from "@openboat/db";
import { eq } from "drizzle-orm";

vi.mock("@/lib/stripe", () => ({
  stripe: {
    refunds: { list: vi.fn() },
    applicationFees: { createRefund: vi.fn(), listRefunds: vi.fn(), list: vi.fn() },
  },
}));

import { stripe } from "@/lib/stripe";
import { markOutsideRefund } from "@/lib/payments/outside-refund";
import { listAttention } from "@/lib/payments/attention";

const ACCT = "acct_outside_refund";
let ctx: SeedResult;

beforeAll(async () => {
  ctx = await seedOperator();
});

afterAll(async () => {
  await cleanupOperator(ctx.operatorId);
});

beforeEach(() => {
  vi.mocked(stripe.refunds.list).mockReset();
  vi.mocked(stripe.applicationFees.createRefund).mockReset();
  vi.mocked(stripe.applicationFees.createRefund).mockResolvedValue({ id: "fr_outside" } as any);
});

/** A paid two-ticket booking ($100 each) with a partial Dashboard refund waiting for review. */
async function seedPartialRefund(tag: string) {
  const piId = `pi_${tag}`;
  const chargeId = `ch_${tag}`;
  const { bookingId, bookingItemId, ticketId } = await seedBooking(ctx, {
    status: "confirmed",
    stripePaymentIntentId: piId,
    stripeAccountId: ACCT,
  });
  const [second] = await testDb
    .insert(tickets)
    .values({
      bookingItemId,
      bookingId,
      operatorId: ctx.operatorId,
      ticketType: "child",
      priceCents: 10000,
      feeAmountCents: 150,
      status: "live",
      voided: false,
      qrPayload: randomUUID(),
    })
    .returning({ id: tickets.id });
  await testDb.insert(payments).values({
    bookingId,
    operatorId: ctx.operatorId,
    stripePaymentIntentId: piId,
    stripeChargeId: chargeId,
    stripeAccountId: ACCT,
    applicationFeeId: `fee_${tag}`,
    amountCents: 20000,
    applicationFeeCents: 300,
    status: "succeeded",
  });
  const eventId = `evt_${tag}`;
  await testDb.insert(stripeEvents).values({
    id: eventId,
    type: "charge.refunded",
    account: ACCT,
    livemode: false,
    stripeCreatedAt: new Date(),
    payload: { id: eventId, type: "charge.refunded", data: { object: { id: chargeId, payment_intent: piId } } },
    processedAt: new Date(),
    outcome: "needs_review",
    operatorId: ctx.operatorId,
    lastError: "refunded in the Stripe Dashboard",
  });
  return { bookingId, eventId, chargeId, first: ticketId, second: second.id };
}

function dashboardRefunds(...amounts: number[]) {
  vi.mocked(stripe.refunds.list).mockResolvedValue({
    data: amounts.map((amount, i) => ({ id: `re_dash_${i}`, amount, status: "succeeded", metadata: {} })),
  } as any);
}

async function ticketRow(id: string) {
  const [row] = await testDb.select().from(tickets).where(eq(tickets.id, id));
  return row;
}

async function eventRow(id: string) {
  const [row] = await testDb.select().from(stripeEvents).where(eq(stripeEvents.id, id));
  return row;
}

describe("markOutsideRefund", () => {
  it("refunds the ticket without paying the customer, frees its seat, returns its fee, and keeps the rest", async () => {
    const s = await seedPartialRefund("or_one");
    dashboardRefunds(10000);
    const [before] = await testDb.select({ seats: trips.seatsRemaining }).from(trips).where(eq(trips.id, ctx.tripId));

    const result = await markOutsideRefund(stripeTestCtx, { operatorId: ctx.operatorId, eventId: s.eventId, ticketId: s.first });

    expect(result).toEqual({ kind: "marked", feeReturnedCents: 150, bookingCancelled: false, resolved: true });
    expect(stripe.refunds.list).toHaveBeenCalledWith({ charge: s.chargeId, limit: 100 }, { stripeAccount: ACCT });
    expect(await ticketRow(s.first)).toMatchObject({ status: "refunded", feeStatus: "reversed" });
    expect(await ticketRow(s.second)).toMatchObject({ status: "live" });
    const [after] = await testDb.select({ seats: trips.seatsRemaining }).from(trips).where(eq(trips.id, ctx.tripId));
    expect(after.seats).toBe((before.seats ?? 0) + 1);

    // Only the platform fee moves; the customer isn't refunded again.
    const cmds = await testDb.select().from(stripeCommands).where(eq(stripeCommands.bookingId, s.bookingId));
    expect(cmds.map((c) => [c.kind, c.targetId, c.amountCents, c.status])).toEqual([["fee_refund", "fee_or_one", 150, "confirmed"]]);
    const [booking] = await testDb.select().from(bookings).where(eq(bookings.id, s.bookingId));
    expect(booking.status).toBe("confirmed");

    // The whole $100 is accounted for: the item leaves Needs attention.
    expect((await eventRow(s.eventId)).resolvedAt).not.toBeNull();
    const audit = await auditRowsFor("tickets", s.first);
    expect(audit.map((a) => a.action)).toContain("ticket.outside_refund");
  });

  it("never marks more than was refunded in Stripe", async () => {
    const s = await seedPartialRefund("or_cap");
    dashboardRefunds(10000);
    await markOutsideRefund(stripeTestCtx, { operatorId: ctx.operatorId, eventId: s.eventId, ticketId: s.first });
    // The event is resolved now; a stale second click finds nothing to act on.
    const again = await markOutsideRefund(stripeTestCtx, { operatorId: ctx.operatorId, eventId: s.eventId, ticketId: s.second });
    expect(again.kind).toBe("not_found");
    expect(await ticketRow(s.second)).toMatchObject({ status: "live" });
  });

  it("refuses a ticket that costs more than what's left, and leaves it boarding", async () => {
    const s = await seedPartialRefund("or_small");
    dashboardRefunds(4000);
    const result = await markOutsideRefund(stripeTestCtx, { operatorId: ctx.operatorId, eventId: s.eventId, ticketId: s.first });
    expect(result).toEqual({ kind: "over_amount", leftCents: 4000 });
    expect(await ticketRow(s.first)).toMatchObject({ status: "live" });
    expect(stripe.applicationFees.createRefund).not.toHaveBeenCalled();
  });

  it("cancels the booking once both tickets are marked, and stays open until then", async () => {
    const s = await seedPartialRefund("or_both");
    dashboardRefunds(10000, 10000);
    const first = await markOutsideRefund(stripeTestCtx, { operatorId: ctx.operatorId, eventId: s.eventId, ticketId: s.first });
    expect(first).toMatchObject({ kind: "marked", resolved: false, bookingCancelled: false });
    expect((await eventRow(s.eventId)).resolvedAt).toBeNull();
    const second = await markOutsideRefund(stripeTestCtx, { operatorId: ctx.operatorId, eventId: s.eventId, ticketId: s.second });
    expect(second).toMatchObject({ kind: "marked", resolved: true, bookingCancelled: true });
    const [booking] = await testDb.select().from(bookings).where(eq(bookings.id, s.bookingId));
    expect(booking.status).toBe("cancelled");
  });

  it("refuses a ticket from another booking", async () => {
    const s = await seedPartialRefund("or_other");
    const elsewhere = await seedBooking(ctx, { status: "confirmed", ticketStatus: "live" });
    dashboardRefunds(10000);
    const result = await markOutsideRefund(stripeTestCtx, {
      operatorId: ctx.operatorId,
      eventId: s.eventId,
      ticketId: elsewhere.ticketId,
    });
    expect(result.kind).toBe("not_refundable");
    expect(await ticketRow(elsewhere.ticketId)).toMatchObject({ status: "live" });
  });

  it("finds nothing for another operator's event", async () => {
    const s = await seedPartialRefund("or_scope");
    const result = await markOutsideRefund(stripeTestCtx, { operatorId: randomUUID(), eventId: s.eventId, ticketId: s.first });
    expect(result.kind).toBe("not_found");
    expect(stripe.refunds.list).not.toHaveBeenCalled();
  });
});

describe("listAttention: outside refunds", () => {
  it("offers the booking's boarding tickets on a partial refund made outside the app", async () => {
    const s = await seedPartialRefund("or_list");
    const items = await listAttention(ctx.operatorId);
    const item = items.find((i) => i.id === s.eventId)!;
    expect(item.confirmationCode).toMatch(/\w{6}/);
    expect(item.outsideRefundTickets!.map((t) => t.id).sort()).toEqual([s.first, s.second].sort());
    expect(item.outsideRefundTickets![0]).toMatchObject({ priceCents: 10000 });
  });
});
