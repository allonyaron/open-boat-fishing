// Row 11: the dispute events Stripe actually sent for two test-mode
// chargebacks on 2026-11-18 (one lost, one won), replayed through the
// dispatcher twice each and out of order (AR-6's test plan). Fixtures are in
// test/fixtures/stripe-disputes; each test gives them its own PaymentIntent.
// They were destination charges on the platform; since row 32 a payment is a
// direct charge on the operator's account, so the replay delivers them as the
// Connect endpoint does, with event.account set.
import { readFileSync } from "fs";
import { join } from "path";
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { seedOperator, cleanupOperator, seedBooking, testDb } from "../db-helpers";
import type { SeedResult } from "../db-helpers";
import { bookings, disputes, operators, payments, stripeCommands, tickets } from "@openboat/db";
import { eq } from "drizzle-orm";
import type Stripe from "stripe";

vi.mock("@/lib/stripe", () => ({
  stripe: {
    paymentIntents: { retrieve: vi.fn() },
    applicationFees: { createRefund: vi.fn(), listRefunds: vi.fn(), list: vi.fn() },
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
  vi.mocked(stripe.applicationFees.createRefund).mockImplementation(async () => ({ id: `fr_fx_${++n}` }) as any);
});

type Outcome = "lost" | "won";

/** The fixture's events, with the PaymentIntent, charge and dispute ids made unique to this test. */
function events(outcome: Outcome, types: string[], tag: string): Stripe.Event[] {
  return types.map((type) => {
    const raw = readFileSync(join(FIXTURES, `${outcome}-charge.dispute.${type}.json`), "utf8");
    const event = JSON.parse(raw) as Stripe.Event;
    const d = event.data.object as Stripe.Dispute;
    const replayed = JSON.parse(
      raw
        .replaceAll(d.payment_intent as string, `pi_${tag}`)
        .replaceAll(d.charge as string, `ch_${tag}`)
        .replaceAll(d.id, `du_${tag}`),
    ) as Stripe.Event;
    return { ...replayed, account: ACCOUNT };
  });
}

async function seedPaid(tag: string) {
  const { bookingId, ticketId } = await seedBooking(ctx, {
    status: "confirmed",
    stripePaymentIntentId: `pi_${tag}`,
    stripeAccountId: ACCOUNT,
  });
  await testDb.insert(payments).values({
    bookingId,
    operatorId: ctx.operatorId,
    stripePaymentIntentId: `pi_${tag}`,
    stripeChargeId: `ch_${tag}`,
    stripeAccountId: ACCOUNT,
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
  const cmds = await testDb.select().from(stripeCommands).where(eq(stripeCommands.bookingId, bookingId));
  return {
    ticket: t.status,
    booking: b.status,
    dispute: d.status,
    disputeFeeCents: d.stripeFeeCents ?? 0,
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
      disputeFeeCents: 1500,
      commands: ["fee_refund:150"],
    });
    expect(stripe.applicationFees.createRefund).toHaveBeenCalledTimes(1);
  });

  it("lost, delivered newest first", async () => {
    const { bookingId, ticketId } = await seedPaid("fx_lost_rev");
    await replay(events("lost", [...LOST_ORDER].reverse(), "fx_lost_rev"));
    expect(await endState("fx_lost_rev", bookingId, ticketId)).toEqual({
      ticket: "refunded",
      booking: "cancelled",
      dispute: "lost",
      disputeFeeCents: 1500,
      commands: ["fee_refund:150"],
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
      disputeFeeCents: 1500,
      commands: [],
    });
  });

  it("won, delivered newest first", async () => {
    const { bookingId, ticketId } = await seedPaid("fx_won_rev");
    await replay(events("won", [...WON_ORDER].reverse(), "fx_won_rev"));
    expect(await endState("fx_won_rev", bookingId, ticketId)).toEqual({
      ticket: "live",
      booking: "confirmed",
      dispute: "won",
      disputeFeeCents: 1500,
      commands: [],
    });
  });
});
