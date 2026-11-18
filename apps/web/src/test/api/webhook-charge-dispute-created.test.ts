import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { seedOperator, cleanupOperator, seedBooking, testDb } from "../db-helpers";
import type { SeedResult } from "../db-helpers";
import { payments, tickets } from "@openboat/db";
import { eq } from "drizzle-orm";

vi.mock("@/lib/stripe", () => ({
  stripe: { paymentIntents: { retrieve: vi.fn() } },
}));

import { stripe } from "@/lib/stripe";
import { handleChargeDisputeCreated } from "@/lib/webhooks/charge-dispute-created";

let ctx: SeedResult;

beforeAll(async () => {
  ctx = await seedOperator();
});

afterAll(async () => {
  await cleanupOperator(ctx.operatorId);
});

async function seedPaidBooking(piId: string) {
  const { bookingId } = await seedBooking(ctx, { status: "confirmed", stripePaymentIntentId: piId });
  await testDb.insert(payments).values({
    bookingId,
    operatorId: ctx.operatorId,
    stripePaymentIntentId: piId,
    amountCents: 10000,
    applicationFeeCents: 150,
    status: "succeeded",
  });
  return bookingId;
}

function dispute(overrides: Record<string, unknown>) {
  return { id: "dp_default", payment_intent: null, ...overrides } as any;
}

describe("handleChargeDisputeCreated", () => {
  it("ignores a dispute with no payment_intent", async () => {
    expect((await handleChargeDisputeCreated(dispute({ payment_intent: null }))).outcome).toBe("ignored");
  });

  it("ignores a dispute on another deployment's payment", async () => {
    vi.mocked(stripe.paymentIntents.retrieve).mockResolvedValueOnce({
      id: "pi_unknown_dispute",
      transfer_data: { destination: "acct_elsewhere" },
    } as any);
    const result = await handleChargeDisputeCreated(dispute({ payment_intent: "pi_unknown_dispute" }));
    expect(result.outcome).toBe("ignored");
  });

  it("throws to be retried when the dispute arrives before the payment was recorded (P3-8)", async () => {
    await seedBooking(ctx, { status: "pending", stripePaymentIntentId: "pi_dispute_early" });
    await expect(
      handleChargeDisputeCreated(dispute({ id: "dp_early", payment_intent: "pi_dispute_early" })),
    ).rejects.toThrow(/before its payment was recorded/);
  });

  it("finishes as needs_review so someone responds to the dispute", async () => {
    await seedPaidBooking("pi_dispute_review");
    const result = await handleChargeDisputeCreated(
      dispute({ id: "dp_review", amount: 10000, reason: "fraudulent", payment_intent: "pi_dispute_review" }),
    );
    expect(result).toMatchObject({ outcome: "needs_review", operatorId: ctx.operatorId });
    expect(result.note).toMatch(/dp_review/);
  });

  it("voids all tickets on the booking and marks their fee reversed", async () => {
    const bookingId = await seedPaidBooking("pi_dispute_1");
    await handleChargeDisputeCreated(dispute({ id: "dp_1", payment_intent: "pi_dispute_1" }));

    const ticketRows = await testDb.select().from(tickets).where(eq(tickets.bookingId, bookingId));
    expect(ticketRows.length).toBeGreaterThan(0);
    expect(ticketRows.every((t) => t.voided === true && t.feeStatus === "reversed")).toBe(true);
  });

  it("is idempotent when tickets are already voided", async () => {
    const bookingId = await seedPaidBooking("pi_dispute_2");
    await handleChargeDisputeCreated(dispute({ id: "dp_2", payment_intent: "pi_dispute_2" }));
    const again = await handleChargeDisputeCreated(dispute({ id: "dp_2_retry", payment_intent: "pi_dispute_2" }));
    expect(again.note).toMatch(/0 ticket\(s\)/);

    const ticketRows = await testDb.select().from(tickets).where(eq(tickets.bookingId, bookingId));
    expect(ticketRows.every((t) => t.voided === true)).toBe(true);
  });
});
