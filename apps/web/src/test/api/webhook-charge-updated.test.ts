// Row 32: a direct charge's balance transaction and application fee arrive on
// the charge.updated that follows payment_intent.succeeded (seen in test mode
// 2026-11-25), and fill in what the payment didn't have yet.
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { seedOperator, cleanupOperator, seedBooking, testDb } from "../db-helpers";
import type { SeedResult } from "../db-helpers";
import { payments } from "@openboat/db";
import { eq } from "drizzle-orm";

vi.mock("@/lib/stripe", () => ({
  stripe: { balanceTransactions: { retrieve: vi.fn() } },
}));

import { stripe } from "@/lib/stripe";
import { handleChargeUpdated } from "@/lib/webhooks/charge-updated";

const ACCT = "acct_charge_updated";
let ctx: SeedResult;

beforeAll(async () => {
  ctx = await seedOperator();
});

afterAll(async () => {
  await cleanupOperator(ctx.operatorId);
});

beforeEach(() => {
  vi.mocked(stripe.balanceTransactions.retrieve).mockReset();
});

async function seedPaid(piId: string, extra: Partial<typeof payments.$inferInsert> = {}) {
  const { bookingId } = await seedBooking(ctx, { status: "confirmed", stripePaymentIntentId: piId, stripeAccountId: ACCT });
  await testDb.insert(payments).values({
    bookingId,
    operatorId: ctx.operatorId,
    stripePaymentIntentId: piId,
    stripeChargeId: `ch_${piId}`,
    stripeAccountId: ACCT,
    amountCents: 11000,
    applicationFeeCents: 300,
    status: "succeeded",
    ...extra,
  });
  return bookingId;
}

async function paymentOf(bookingId: string) {
  const [row] = await testDb.select().from(payments).where(eq(payments.bookingId, bookingId));
  return row;
}

const charge = (piId: string, extra: Record<string, unknown> = {}) =>
  ({ id: `ch_${piId}`, payment_intent: piId, application_fee: "fee_later", balance_transaction: "txn_later", ...extra }) as any;

describe("handleChargeUpdated", () => {
  it("records the fee's id and Stripe's processing fee, reading the balance transaction on the operator's account", async () => {
    const bookingId = await seedPaid("pi_cu_fill");
    vi.mocked(stripe.balanceTransactions.retrieve).mockResolvedValueOnce({
      fee_details: [
        { type: "stripe_fee", amount: 349 },
        { type: "application_fee", amount: 300 },
      ],
    } as any);

    const result = await handleChargeUpdated(charge("pi_cu_fill"), ACCT);

    expect(result.outcome).toBe("handled");
    expect(stripe.balanceTransactions.retrieve).toHaveBeenCalledWith("txn_later", {}, { stripeAccount: ACCT });
    expect(await paymentOf(bookingId)).toMatchObject({ applicationFeeId: "fee_later", stripeFeeCents: 349 });
  });

  it("keeps what was already recorded and asks Stripe nothing", async () => {
    const bookingId = await seedPaid("pi_cu_done", { applicationFeeId: "fee_first", stripeFeeCents: 100 });
    const result = await handleChargeUpdated(charge("pi_cu_done"), ACCT);
    expect(result.outcome).toBe("ignored");
    expect(stripe.balanceTransactions.retrieve).not.toHaveBeenCalled();
    expect(await paymentOf(bookingId)).toMatchObject({ applicationFeeId: "fee_first", stripeFeeCents: 100 });
  });

  it("ignores an event from another account than the payment's", async () => {
    const bookingId = await seedPaid("pi_cu_other");
    expect((await handleChargeUpdated(charge("pi_cu_other"), "acct_x")).outcome).toBe("ignored");
    expect(await paymentOf(bookingId)).toMatchObject({ applicationFeeId: null, stripeFeeCents: null });
  });

  it("throws to be retried when it arrives before the payment was recorded", async () => {
    await seedBooking(ctx, { status: "pending", stripePaymentIntentId: "pi_cu_early", stripeAccountId: ACCT });
    await expect(handleChargeUpdated(charge("pi_cu_early"), ACCT)).rejects.toThrow(/before its payment was recorded/);
  });
});
