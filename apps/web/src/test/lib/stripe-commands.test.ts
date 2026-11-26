// Row 10: the Stripe command outbox. A refund is recorded, then sent with its
// own id as the idempotency key; a lost answer is found again by metadata
// after Stripe's 24-hour window; Stripe refusing a request marks it failed;
// network errors leave it pending for the cron.
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { seedOperator, cleanupOperator, seedBooking, testDb, stripeTestCtx } from "../db-helpers";
import type { SeedResult } from "../db-helpers";
import { payments, stripeCommands } from "@openboat/db";
import { eq } from "drizzle-orm";

vi.mock("@/lib/stripe", () => ({
  stripe: {
    refunds: { create: vi.fn(), list: vi.fn() },
    applicationFees: { createRefund: vi.fn(), listRefunds: vi.fn(), list: vi.fn() },
  },
}));

import { stripe } from "@/lib/stripe";
import {
  confirmRefundCommands,
  queueFeeRefund,
  queueRefund,
  sendCommand,
  sendPendingCommands,
} from "@/lib/payments/commands";
import { db } from "@/lib/db";

let ctx: SeedResult;

beforeAll(async () => {
  ctx = await seedOperator();
});

afterAll(async () => {
  await cleanupOperator(ctx.operatorId);
});

beforeEach(() => {
  vi.mocked(stripe.refunds.create).mockReset();
  vi.mocked(stripe.refunds.list).mockReset();
  vi.mocked(stripe.applicationFees.createRefund).mockReset();
  vi.mocked(stripe.applicationFees.listRefunds).mockReset();
  vi.mocked(stripe.applicationFees.list).mockReset();
});

// The operator's account, which a direct charge's refunds are made on (row 32).
const ACCT = "acct_cmd";

function refund(paymentIntentId: string, extra: Partial<Parameters<typeof queueRefund>[1]> = {}) {
  return queueRefund(db, {
    ctx: stripeTestCtx,
    operatorId: ctx.operatorId,
    bookingId: null,
    paymentIntentId,
    stripeAccount: ACCT,
    amountCents: 2500,
    reason: "admin_ticket_refund",
    refundApplicationFee: false,
    ...extra,
  });
}

async function command(id: string) {
  const [row] = await testDb.select().from(stripeCommands).where(eq(stripeCommands.id, id));
  return row;
}

describe("queueRefund", () => {
  it("stores the exact request, with its own id as command_id", async () => {
    const id = await refund("pi_q1", { metadata: { ticketId: "t1" } });
    const row = await command(id);
    expect(row).toMatchObject({ status: "pending", kind: "refund", targetId: "pi_q1", amountCents: 2500, stripeAccount: ACCT });
    expect(row.params).toMatchObject({
      payment_intent: "pi_q1",
      amount: 2500,
      refund_application_fee: false,
      metadata: { ticketId: "t1", reason: "admin_ticket_refund", command_id: id },
    });
    // A direct charge has no transfer to reverse.
    expect(row.params).not.toHaveProperty("reverse_transfer");
  });

  it("reverses the transfer of a destination charge made before row 32, on the platform", async () => {
    vi.mocked(stripe.refunds.create).mockResolvedValueOnce({ id: "re_legacy" } as never);
    const id = await refund("pi_legacy", { stripeAccount: null });
    const row = await command(id);
    expect(row.stripeAccount).toBeNull();
    expect(row.params).toMatchObject({ reverse_transfer: true });
    expect(await sendCommand(id)).toBe("sent");
    expect(vi.mocked(stripe.refunds.create).mock.calls[0][1]).toEqual({ idempotencyKey: id });
  });

  it("returns the existing command for a repeated dedupe key", async () => {
    const a = await refund("pi_q2", { dedupeKey: "auto-refund:pi_q2", amountCents: null });
    const b = await refund("pi_q2", { dedupeKey: "auto-refund:pi_q2", amountCents: null });
    expect(b).toBe(a);
    expect((await command(a)).params).not.toHaveProperty("amount");
  });
});

describe("sendCommand", () => {
  it("sends with the command id as idempotency key and marks a refund sent", async () => {
    vi.mocked(stripe.refunds.create).mockResolvedValueOnce({ id: "re_ok" } as never);
    const id = await refund("pi_s1");
    expect(await sendCommand(id)).toBe("sent");
    expect(stripe.refunds.create).toHaveBeenCalledWith(expect.objectContaining({ payment_intent: "pi_s1" }), {
      stripeAccount: ACCT,
      idempotencyKey: id,
    });
    expect(await command(id)).toMatchObject({ status: "sent", stripeObjectId: "re_ok", attempts: 1, lastError: null });
    // Not pending any more: a second send does nothing.
    expect(await sendCommand(id)).toBe("skipped");
    expect(stripe.refunds.create).toHaveBeenCalledTimes(1);
  });

  it("confirms a fee refund as soon as Stripe accepts it", async () => {
    vi.mocked(stripe.applicationFees.createRefund).mockResolvedValueOnce({ id: "fr_ok" } as never);
    const id = await queueFeeRefund(db, {
      ctx: stripeTestCtx,
      operatorId: ctx.operatorId,
      bookingId: null,
      feeOrChargeId: "fee_s2",
      amountCents: 150,
      reason: "admin_ticket_refund",
    });
    expect(await sendCommand(id)).toBe("confirmed");
    // On the platform, which holds the fee: no Stripe-Account header.
    expect(stripe.applicationFees.createRefund).toHaveBeenCalledWith(
      "fee_s2",
      expect.objectContaining({ amount: 150 }),
      { idempotencyKey: id },
    );
  });

  it("finds a direct charge's fee by its charge when the payment doesn't have it yet, and saves it", async () => {
    const booking = await seedBooking(ctx, { status: "confirmed", stripePaymentIntentId: "pi_feelookup" });
    await testDb.insert(payments).values({
      bookingId: booking.bookingId,
      operatorId: ctx.operatorId,
      stripePaymentIntentId: "pi_feelookup",
      stripeChargeId: "ch_feelookup",
      stripeAccountId: ACCT,
      amountCents: 10000,
      applicationFeeCents: 150,
      status: "succeeded",
    });
    const id = await queueFeeRefund(db, {
      ctx: stripeTestCtx,
      operatorId: ctx.operatorId,
      bookingId: booking.bookingId,
      feeOrChargeId: "ch_feelookup",
      amountCents: 150,
      reason: "admin_ticket_refund",
    });

    // Stripe hasn't created it yet: the command waits for the cron.
    vi.mocked(stripe.applicationFees.list).mockResolvedValueOnce({ data: [] } as never);
    expect(await sendCommand(id)).toBe("pending");
    expect((await command(id)).lastError).toMatch(/hasn't been created yet/);
    expect(stripe.applicationFees.createRefund).not.toHaveBeenCalled();

    vi.mocked(stripe.applicationFees.list).mockResolvedValue({ data: [{ id: "fee_found" }] } as never);
    vi.mocked(stripe.applicationFees.listRefunds).mockResolvedValueOnce({ data: [] } as never);
    vi.mocked(stripe.applicationFees.createRefund).mockResolvedValueOnce({ id: "fr_found" } as never);
    expect(await sendCommand(id)).toBe("confirmed");
    expect(stripe.applicationFees.list).toHaveBeenCalledWith({ charge: "ch_feelookup", limit: 1 });
    expect(vi.mocked(stripe.applicationFees.createRefund).mock.calls[0][0]).toBe("fee_found");
    const [payment] = await testDb.select().from(payments).where(eq(payments.bookingId, booking.bookingId));
    expect(payment.applicationFeeId).toBe("fee_found");
  });

  it("leaves a command pending on a network error, and on retry finds the refund an earlier attempt made", async () => {
    vi.mocked(stripe.refunds.create).mockRejectedValueOnce(
      Object.assign(new Error("socket hang up"), { type: "StripeConnectionError" }),
    );
    const id = await refund("pi_s3");
    expect(await sendCommand(id)).toBe("pending");
    expect(await command(id)).toMatchObject({ status: "pending", attempts: 1 });

    // The first request actually reached Stripe; only its answer was lost.
    vi.mocked(stripe.refunds.list).mockResolvedValueOnce({
      data: [{ id: "re_earlier", metadata: { command_id: id } }],
    } as never);
    expect(await sendCommand(id)).toBe("sent");
    expect(stripe.refunds.create).toHaveBeenCalledTimes(1);
    expect(await command(id)).toMatchObject({ status: "sent", stripeObjectId: "re_earlier", attempts: 2 });
  });

  it("uses a fresh idempotency key on a retry once no earlier refund is found", async () => {
    vi.mocked(stripe.refunds.create).mockRejectedValueOnce(
      Object.assign(new Error("Internal server error"), { type: "StripeAPIError" }),
    );
    const id = await refund("pi_s5");
    expect(await sendCommand(id)).toBe("pending");

    vi.mocked(stripe.refunds.list).mockResolvedValueOnce({ data: [] } as never);
    vi.mocked(stripe.refunds.create).mockResolvedValueOnce({ id: "re_second" } as never);
    expect(await sendCommand(id)).toBe("sent");
    expect(vi.mocked(stripe.refunds.create).mock.calls.map((c) => c[1])).toEqual([
      { stripeAccount: ACCT, idempotencyKey: id },
      { stripeAccount: ACCT, idempotencyKey: `${id}:2` },
    ]);
    expect(vi.mocked(stripe.refunds.list).mock.calls[0][1]).toEqual({ stripeAccount: ACCT });
  });

  it("marks a command failed when Stripe refuses the request", async () => {
    vi.mocked(stripe.refunds.create).mockRejectedValueOnce(
      Object.assign(new Error("Refund amount is greater than unrefunded amount"), {
        type: "StripeInvalidRequestError",
        code: "amount_too_large",
      }),
    );
    const id = await refund("pi_s4");
    expect(await sendCommand(id)).toBe("failed");
    const row = await command(id);
    expect(row.status).toBe("failed");
    expect(row.lastError).toMatch(/amount_too_large/);
  });
});

describe("sendPendingCommands", () => {
  it("sends what is still pending, oldest first", async () => {
    vi.mocked(stripe.refunds.create).mockRejectedValueOnce(
      Object.assign(new Error("rate limited"), { type: "StripeRateLimitError" }),
    );
    const id = await refund("pi_p1");
    expect(await sendCommand(id)).toBe("pending");

    vi.mocked(stripe.refunds.list).mockResolvedValue({ data: [] } as never);
    vi.mocked(stripe.refunds.create).mockResolvedValue({ id: "re_drained" } as never);
    const counts = await sendPendingCommands({ limit: 500 });
    expect(counts.sent).toBeGreaterThanOrEqual(1);
    expect(await command(id)).toMatchObject({ status: "sent", stripeObjectId: "re_drained" });
  });
});

describe("confirmRefundCommands", () => {
  it("confirms sent or pending refund commands matched by metadata", async () => {
    vi.mocked(stripe.refunds.create).mockResolvedValueOnce({ id: "re_c1" } as never);
    const id = await refund("pi_c1");
    await sendCommand(id);
    const confirmed = await confirmRefundCommands([
      { id: "re_c1", metadata: { command_id: id } },
      { id: "re_dash", metadata: {} },
    ] as never);
    expect(confirmed).toEqual([id]);
    expect(await command(id)).toMatchObject({ status: "confirmed" });
  });
});
