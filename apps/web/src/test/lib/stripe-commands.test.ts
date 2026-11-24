// Row 10: the Stripe command outbox. A refund is recorded, then sent with its
// own id as the idempotency key; a lost answer is found again by metadata
// after Stripe's 24-hour window; Stripe refusing a request marks it failed;
// network errors leave it pending for the cron.
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { seedOperator, cleanupOperator, testDb } from "../db-helpers";
import type { SeedResult } from "../db-helpers";
import { stripeCommands } from "@openboat/db";
import { eq } from "drizzle-orm";

vi.mock("@/lib/stripe", () => ({
  stripe: {
    refunds: { create: vi.fn(), list: vi.fn() },
    applicationFees: { createRefund: vi.fn(), listRefunds: vi.fn() },
    transfers: { createReversal: vi.fn(), listReversals: vi.fn(), create: vi.fn(), list: vi.fn() },
  },
}));

import { stripe } from "@/lib/stripe";
import {
  confirmRefundCommands,
  queueFeeRefund,
  queueRefund,
  queueTransfer,
  queueTransferReversal,
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
});

function refund(paymentIntentId: string, extra: Partial<Parameters<typeof queueRefund>[1]> = {}) {
  return queueRefund(db, {
    operatorId: ctx.operatorId,
    bookingId: null,
    paymentIntentId,
    amountCents: 2500,
    reason: "admin_ticket_refund",
    reverseTransfer: true,
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
    expect(row).toMatchObject({ status: "pending", kind: "refund", targetId: "pi_q1", amountCents: 2500 });
    expect(row.params).toMatchObject({
      payment_intent: "pi_q1",
      amount: 2500,
      reverse_transfer: true,
      refund_application_fee: false,
      metadata: { ticketId: "t1", reason: "admin_ticket_refund", command_id: id },
    });
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
      operatorId: ctx.operatorId,
      bookingId: null,
      applicationFeeId: "fee_s2",
      amountCents: 150,
      reason: "admin_ticket_refund",
    });
    expect(await sendCommand(id)).toBe("confirmed");
    expect(stripe.applicationFees.createRefund).toHaveBeenCalledWith(
      "fee_s2",
      expect.objectContaining({ amount: 150 }),
      { idempotencyKey: id },
    );
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
      { idempotencyKey: id },
      { idempotencyKey: `${id}:2` },
    ]);
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

// Row 11: transfer reversals and transfers go through the same outbox.
describe("transfer commands", () => {
  beforeEach(() => {
    vi.mocked(stripe.transfers.createReversal).mockReset();
    vi.mocked(stripe.transfers.listReversals).mockReset();
    vi.mocked(stripe.transfers.create).mockReset();
    vi.mocked(stripe.transfers.list).mockReset();
  });

  it("sends a transfer reversal with its id as the key and confirms it on acceptance", async () => {
    const id = await queueTransferReversal(db, {
      operatorId: ctx.operatorId,
      bookingId: null,
      transferId: "tr_cmd_1",
      amountCents: 5000,
      reason: "chargeback",
    });
    vi.mocked(stripe.transfers.createReversal).mockResolvedValueOnce({ id: "trr_cmd_1" } as any);
    expect(await sendCommand(id)).toBe("confirmed");
    expect(stripe.transfers.createReversal).toHaveBeenCalledWith(
      "tr_cmd_1",
      { amount: 5000, metadata: { reason: "chargeback", command_id: id } },
      { idempotencyKey: id },
    );
    expect(stripe.refunds.create).not.toHaveBeenCalled();
    expect(stripe.applicationFees.createRefund).not.toHaveBeenCalled();
    expect(await command(id)).toMatchObject({ status: "confirmed", stripeObjectId: "trr_cmd_1" });
  });

  it("finds a reversal an earlier attempt made instead of making a second one", async () => {
    const id = await queueTransferReversal(db, {
      operatorId: ctx.operatorId,
      bookingId: null,
      transferId: "tr_cmd_2",
      amountCents: 5000,
      reason: "chargeback",
    });
    vi.mocked(stripe.transfers.createReversal).mockRejectedValueOnce(
      Object.assign(new Error("socket hang up"), { type: "StripeConnectionError" }),
    );
    expect(await sendCommand(id)).toBe("pending");
    vi.mocked(stripe.transfers.listReversals).mockResolvedValueOnce({
      data: [{ id: "trr_lost_answer", metadata: { command_id: id } }],
    } as any);
    expect(await sendCommand(id)).toBe("confirmed");
    expect(stripe.transfers.createReversal).toHaveBeenCalledTimes(1);
    expect((await command(id)).stripeObjectId).toBe("trr_lost_answer");
  });

  it("sends a transfer funded by the original charge", async () => {
    const id = await queueTransfer(db, {
      operatorId: ctx.operatorId,
      bookingId: null,
      destination: "acct_cmd",
      sourceChargeId: "ch_cmd",
      amountCents: 5000,
      reason: "chargeback_won",
    });
    vi.mocked(stripe.transfers.create).mockResolvedValueOnce({ id: "tr_back" } as any);
    expect(await sendCommand(id)).toBe("confirmed");
    expect(stripe.transfers.create).toHaveBeenCalledWith(
      expect.objectContaining({ amount: 5000, currency: "usd", destination: "acct_cmd", source_transaction: "ch_cmd" }),
      { idempotencyKey: id },
    );
  });

  it("finds a transfer an earlier attempt made", async () => {
    const id = await queueTransfer(db, {
      operatorId: ctx.operatorId,
      bookingId: null,
      destination: "acct_cmd",
      sourceChargeId: "ch_cmd",
      amountCents: 5000,
      reason: "chargeback_won",
    });
    vi.mocked(stripe.transfers.create).mockRejectedValueOnce(
      Object.assign(new Error("timeout"), { type: "StripeAPIError" }),
    );
    expect(await sendCommand(id)).toBe("pending");
    vi.mocked(stripe.transfers.list).mockResolvedValueOnce({
      data: [{ id: "tr_other", metadata: {} }, { id: "tr_found", metadata: { command_id: id } }],
    } as any);
    expect(await sendCommand(id)).toBe("confirmed");
    expect(vi.mocked(stripe.transfers.list).mock.calls[0][0]).toMatchObject({ destination: "acct_cmd" });
    expect((await command(id)).stripeObjectId).toBe("tr_found");
  });
});
