import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { seedOperator, cleanupOperator, testDb } from "../db-helpers";
import type { SeedResult } from "../db-helpers";
import { operators } from "@openboat/db";
import { eq } from "drizzle-orm";

vi.mock("@/lib/stripe", () => ({
  stripe: { webhooks: { constructEvent: vi.fn() } },
}));
vi.mock("@/lib/webhooks/payment-intent-succeeded", () => ({
  handlePaymentIntentSucceeded: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/webhooks/payment-intent-canceled", () => ({
  handlePaymentIntentCanceled: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/webhooks/charge-refunded", () => ({
  handleChargeRefunded: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/webhooks/charge-dispute-created", () => ({
  handleChargeDisputeCreated: vi.fn().mockResolvedValue(undefined),
}));

import { stripe } from "@/lib/stripe";
import { handlePaymentIntentSucceeded } from "@/lib/webhooks/payment-intent-succeeded";
import { handlePaymentIntentCanceled } from "@/lib/webhooks/payment-intent-canceled";
import { handleChargeRefunded } from "@/lib/webhooks/charge-refunded";
import { handleChargeDisputeCreated } from "@/lib/webhooks/charge-dispute-created";

let ctx: SeedResult;

beforeAll(async () => {
  ctx = await seedOperator();
});

afterAll(async () => {
  await cleanupOperator(ctx.operatorId);
});

beforeEach(() => {
  vi.mocked(stripe.webhooks.constructEvent).mockReset();
  vi.mocked(handlePaymentIntentSucceeded).mockClear();
  vi.mocked(handlePaymentIntentCanceled).mockClear();
  vi.mocked(handleChargeRefunded).mockClear();
  vi.mocked(handleChargeDisputeCreated).mockClear();
});

function req(body: string, sig?: string) {
  return new NextRequest("http://localhost/api/webhooks/stripe", {
    method: "POST",
    body,
    headers: sig ? { "stripe-signature": sig } : {},
  });
}

describe("POST /api/webhooks/stripe", () => {
  it("returns 400 when the stripe-signature header is missing", async () => {
    const { POST } = await import("@/app/api/webhooks/stripe/route");
    const res = await POST(req("{}"));
    expect(res.status).toBe(400);
    expect(stripe.webhooks.constructEvent).not.toHaveBeenCalled();
  });

  it("returns 400 when signature verification throws", async () => {
    vi.mocked(stripe.webhooks.constructEvent).mockImplementation(() => {
      throw new Error("signature mismatch");
    });
    const { POST } = await import("@/app/api/webhooks/stripe/route");
    const res = await POST(req("{}", "bad-sig"));
    expect(res.status).toBe(400);
  });

  it("returns 400 for an event from an unknown connected account", async () => {
    vi.mocked(stripe.webhooks.constructEvent).mockReturnValue({
      type: "payment_intent.succeeded",
      account: "acct_unknown_00000",
      data: { object: {} },
    } as any);
    const { POST } = await import("@/app/api/webhooks/stripe/route");
    const res = await POST(req("{}", "sig"));
    expect(res.status).toBe(400);
    expect(handlePaymentIntentSucceeded).not.toHaveBeenCalled();
  });

  it("processes an event whose account matches a known operator", async () => {
    await testDb.update(operators).set({ stripeAccountId: "acct_known_123" }).where(eq(operators.id, ctx.operatorId));
    const pi = { id: "pi_1", metadata: { bookingId: "b1" } };
    vi.mocked(stripe.webhooks.constructEvent).mockReturnValue({
      type: "payment_intent.succeeded",
      account: "acct_known_123",
      data: { object: pi },
    } as any);

    const { POST } = await import("@/app/api/webhooks/stripe/route");
    const res = await POST(req(JSON.stringify(pi), "sig"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(handlePaymentIntentSucceeded).toHaveBeenCalledWith(pi);
  });

  it("processes an event with no account field (single-deploy mode)", async () => {
    const pi = { id: "pi_2", metadata: { bookingId: "b2" } };
    vi.mocked(stripe.webhooks.constructEvent).mockReturnValue({
      type: "payment_intent.succeeded",
      data: { object: pi },
    } as any);

    const { POST } = await import("@/app/api/webhooks/stripe/route");
    const res = await POST(req(JSON.stringify(pi), "sig"));
    expect(res.status).toBe(200);
    expect(handlePaymentIntentSucceeded).toHaveBeenCalledWith(pi);
  });

  it("dispatches payment_intent.canceled to its handler", async () => {
    const pi = { id: "pi_3" };
    vi.mocked(stripe.webhooks.constructEvent).mockReturnValue({
      type: "payment_intent.canceled",
      data: { object: pi },
    } as any);
    const { POST } = await import("@/app/api/webhooks/stripe/route");
    const res = await POST(req(JSON.stringify(pi), "sig"));
    expect(res.status).toBe(200);
    expect(handlePaymentIntentCanceled).toHaveBeenCalledWith(pi);
  });

  it("dispatches charge.refunded to its handler", async () => {
    const charge = { id: "ch_1" };
    vi.mocked(stripe.webhooks.constructEvent).mockReturnValue({
      type: "charge.refunded",
      data: { object: charge },
    } as any);
    const { POST } = await import("@/app/api/webhooks/stripe/route");
    const res = await POST(req(JSON.stringify(charge), "sig"));
    expect(res.status).toBe(200);
    expect(handleChargeRefunded).toHaveBeenCalledWith(charge);
  });

  it("dispatches charge.dispute.created to its handler", async () => {
    const dispute = { id: "dp_1" };
    vi.mocked(stripe.webhooks.constructEvent).mockReturnValue({
      type: "charge.dispute.created",
      data: { object: dispute },
    } as any);
    const { POST } = await import("@/app/api/webhooks/stripe/route");
    const res = await POST(req(JSON.stringify(dispute), "sig"));
    expect(res.status).toBe(200);
    expect(handleChargeDisputeCreated).toHaveBeenCalledWith(dispute);
  });

  it("returns 200 ok:true and calls no handler for an unrecognized event type", async () => {
    vi.mocked(stripe.webhooks.constructEvent).mockReturnValue({
      type: "customer.created",
      data: { object: {} },
    } as any);
    const { POST } = await import("@/app/api/webhooks/stripe/route");
    const res = await POST(req("{}", "sig"));
    expect(res.status).toBe(200);
    expect(handlePaymentIntentSucceeded).not.toHaveBeenCalled();
    expect(handlePaymentIntentCanceled).not.toHaveBeenCalled();
    expect(handleChargeRefunded).not.toHaveBeenCalled();
    expect(handleChargeDisputeCreated).not.toHaveBeenCalled();
  });
});
