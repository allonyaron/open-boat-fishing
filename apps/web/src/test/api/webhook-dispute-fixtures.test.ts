// Row 11: the dispute events Stripe actually sent for two test-mode
// chargebacks on 2026-11-18 (one lost, one won), replayed through the
// dispatcher twice each and out of order (AR-6's test plan). Fixtures are in
// test/fixtures/stripe-disputes; each test gives them its own PaymentIntent.
import { readFileSync } from "fs";
import { join } from "path";
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { seedOperator, cleanupOperator, seedBooking, testDb } from "../db-helpers";
import type { SeedResult } from "../db-helpers";
import { bookings, disputes, operatorDebts, operators, payments, stripeCommands, tickets } from "@openboat/db";
import { eq } from "drizzle-orm";
import type Stripe from "stripe";

vi.mock("@/lib/stripe", () => ({
  stripe: {
    paymentIntents: { retrieve: vi.fn() },
    transfers: { retrieve: vi.fn(), createReversal: vi.fn(), listReversals: vi.fn(), create: vi.fn(), list: vi.fn() },
    applicationFees: { createRefund: vi.fn(), listRefunds: vi.fn() },
  },
}));

import { stripe } from "@/lib/stripe";
import { dispatchStripeEvent } from "@/lib/stripe-events/dispatch";

const FIXTURES = join(__dirname, "../fixtures/stripe-disputes");
const ACCOUNT = "acct_1TpdmKQ2psTV61Cr";

let ctx: SeedResult;
let n = 0;

beforeAll(async () => {
  ctx = await seedOperator();
  await testDb.update(operators).set({ stripeAccountId: ACCOUNT }).where(eq(operators.id, ctx.operatorId));
});

afterAll(async () => {
  await cleanupOperator(ctx.operatorId);
});

beforeEach(() => {
  vi.mocked(stripe.transfers.retrieve).mockResolvedValue({ amount: 5000, amount_reversed: 0 } as any);
  vi.mocked(stripe.transfers.createReversal).mockImplementation(async () => ({ id: `trr_fx_${++n}` }) as any);
  vi.mocked(stripe.transfers.create).mockImplementation(async () => ({ id: `tr_fx_${++n}` }) as any);
  vi.mocked(stripe.applicationFees.createRefund).mockImplementation(async () => ({ id: `fr_fx_${++n}` }) as any);
});

type Outcome = "lost" | "won";

/** The fixture's events, with the PaymentIntent, charge and dispute ids made unique to this test. */
function events(outcome: Outcome, types: string[], tag: string): Stripe.Event[] {
  return types.map((type) => {
    const raw = readFileSync(join(FIXTURES, `${outcome}-charge.dispute.${type}.json`), "utf8");
    const event = JSON.parse(raw) as Stripe.Event;
    const d = event.data.object as Stripe.Dispute;
    return JSON.parse(
      raw
        .replaceAll(d.payment_intent as string, `pi_${tag}`)
        .replaceAll(d.charge as string, `ch_${tag}`)
        .replaceAll(d.id, `du_${tag}`),
    ) as Stripe.Event;
  });
}

async function seedPaid(tag: string) {
  const { bookingId, ticketId } = await seedBooking(ctx, { status: "confirmed", stripePaymentIntentId: `pi_${tag}` });
  await testDb.insert(payments).values({
    bookingId,
    operatorId: ctx.operatorId,
    stripePaymentIntentId: `pi_${tag}`,
    stripeChargeId: `ch_${tag}`,
    stripeTransferId: `tr_${tag}`,
    applicationFeeId: `fee_${tag}`,
    amountCents: 5000,
    applicationFeeCents: 150,
    status: "succeeded",
  });
  return { bookingId, ticketId };
}

async function replay(list: Stripe.Event[]) {
  for (const e of list) await dispatchStripeEvent(e);
}

async function endState(tag: string, bookingId: string, ticketId: string) {
  const [t] = await testDb.select().from(tickets).where(eq(tickets.id, ticketId));
  const [b] = await testDb.select().from(bookings).where(eq(bookings.id, bookingId));
  const [d] = await testDb.select().from(disputes).where(eq(disputes.id, `du_${tag}`));
  const [debt] = await testDb.select().from(operatorDebts).where(eq(operatorDebts.disputeId, `du_${tag}`));
  const cmds = await testDb.select().from(stripeCommands).where(eq(stripeCommands.bookingId, bookingId));
  return {
    ticket: t.status,
    booking: b.status,
    dispute: d.status,
    debtCents: debt?.amountCents ?? 0,
    commands: cmds.map((c) => `${c.kind}:${c.amountCents}`).sort(),
  };
}

const LOST_ORDER = ["created", "funds_withdrawn", "updated", "closed"];
const WON_ORDER = ["created", "funds_withdrawn", "updated", "funds_reinstated", "closed"];

describe("real dispute events", () => {
  it("lost, in order and then all again", async () => {
    const { bookingId, ticketId } = await seedPaid("fx_lost");
    const list = events("lost", LOST_ORDER, "fx_lost");
    await replay(list);
    await replay(list);
    expect(await endState("fx_lost", bookingId, ticketId)).toEqual({
      ticket: "refunded",
      booking: "cancelled",
      dispute: "lost",
      debtCents: 1500,
      commands: ["fee_refund:150", "transfer_reversal:5000"],
    });
    expect(stripe.transfers.createReversal).toHaveBeenCalledTimes(1);
  });

  it("lost, delivered newest first", async () => {
    const { bookingId, ticketId } = await seedPaid("fx_lost_rev");
    vi.mocked(stripe.transfers.createReversal).mockClear();
    await replay(events("lost", [...LOST_ORDER].reverse(), "fx_lost_rev"));
    expect(await endState("fx_lost_rev", bookingId, ticketId)).toEqual({
      ticket: "refunded",
      booking: "cancelled",
      dispute: "lost",
      debtCents: 1500,
      commands: ["fee_refund:150", "transfer_reversal:5000"],
    });
  });

  it("won, in order and then all again", async () => {
    const { bookingId, ticketId } = await seedPaid("fx_won");
    const list = events("won", WON_ORDER, "fx_won");
    await replay(list);
    await replay(list);
    expect(await endState("fx_won", bookingId, ticketId)).toEqual({
      ticket: "live",
      booking: "confirmed",
      dispute: "won",
      debtCents: 1500,
      commands: ["transfer:5000", "transfer_reversal:5000"],
    });
  });

  it("won, delivered newest first: nothing is taken back, so nothing is returned", async () => {
    const { bookingId, ticketId } = await seedPaid("fx_won_rev");
    await replay(events("won", [...WON_ORDER].reverse(), "fx_won_rev"));
    expect(await endState("fx_won_rev", bookingId, ticketId)).toEqual({
      ticket: "live",
      booking: "confirmed",
      dispute: "won",
      debtCents: 1500,
      commands: [],
    });
  });
});
