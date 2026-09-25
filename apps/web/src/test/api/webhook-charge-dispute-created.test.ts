import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { seedOperator, cleanupOperator, seedBooking, testDb } from "../db-helpers";
import type { SeedResult } from "../db-helpers";
import { payments, tickets } from "@openboat/db";
import { eq } from "drizzle-orm";
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
  it("does nothing when the dispute has no payment_intent", async () => {
    await expect(handleChargeDisputeCreated(dispute({ payment_intent: null }))).resolves.toBeUndefined();
  });

  it("does nothing when no payment row matches the payment_intent", async () => {
    await expect(
      handleChargeDisputeCreated(dispute({ payment_intent: "pi_unknown_dispute" })),
    ).resolves.toBeUndefined();
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
    await expect(
      handleChargeDisputeCreated(dispute({ id: "dp_2_retry", payment_intent: "pi_dispute_2" })),
    ).resolves.toBeUndefined();

    const ticketRows = await testDb.select().from(tickets).where(eq(tickets.bookingId, bookingId));
    expect(ticketRows.every((t) => t.voided === true)).toBe(true);
  });
});
