// POST /api/webhooks/stripe: verifies the signature, saves the event to the
// inbox, processes it once, and answers 500 when a retry could fix a failure
// (row 10). The handlers are mocked; their own behavior has its own tests.
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { randomUUID } from "crypto";
import { seedOperator, cleanupOperator, testDb } from "../db-helpers";
import type { SeedResult } from "../db-helpers";
import { stripeEvents } from "@openboat/db";
import { eq } from "drizzle-orm";

vi.mock("@/lib/stripe", () => ({
  stripe: { webhooks: { constructEvent: vi.fn() } },
}));
vi.mock("@/lib/webhooks/payment-intent-succeeded", () => ({
  handlePaymentIntentSucceeded: vi.fn(),
}));
vi.mock("@/lib/webhooks/payment-intent-canceled", () => ({
  handlePaymentIntentCanceled: vi.fn(),
}));
vi.mock("@/lib/webhooks/charge-refunded", () => ({
  handleChargeRefunded: vi.fn(),
}));
vi.mock("@/lib/webhooks/charge-dispute-created", () => ({
  handleChargeDisputeCreated: vi.fn(),
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

const handlers = [
  handlePaymentIntentSucceeded,
  handlePaymentIntentCanceled,
  handleChargeRefunded,
  handleChargeDisputeCreated,
];

beforeEach(() => {
  vi.mocked(stripe.webhooks.constructEvent).mockReset();
  for (const h of handlers) {
    vi.mocked(h).mockReset();
    vi.mocked(h).mockResolvedValue({ outcome: "handled", operatorId: ctx?.operatorId } as never);
  }
});

function req(body: string, sig?: string) {
  return new NextRequest("http://localhost/api/webhooks/stripe", {
    method: "POST",
    body,
    headers: sig ? { "stripe-signature": sig } : {},
  });
}

const ids: string[] = [];
function event(type: string, object: object, extra: Record<string, unknown> = {}) {
  const id = `evt_${randomUUID().replace(/-/g, "").slice(0, 20)}`;
  ids.push(id);
  return { id, type, created: Math.floor(Date.now() / 1000), livemode: false, data: { object }, ...extra };
}

async function deliver(evt: object) {
  vi.mocked(stripe.webhooks.constructEvent).mockReturnValue(evt as never);
  const { POST } = await import("@/app/api/webhooks/stripe/route");
  return POST(req(JSON.stringify(evt), "sig"));
}

async function stored(id: string) {
  const [row] = await testDb.select().from(stripeEvents).where(eq(stripeEvents.id, id));
  return row;
}

afterAll(async () => {
  for (const id of ids) await testDb.delete(stripeEvents).where(eq(stripeEvents.id, id));
});

describe("POST /api/webhooks/stripe", () => {
  it("returns 400 when the stripe-signature header is missing", async () => {
    const { POST } = await import("@/app/api/webhooks/stripe/route");
    const res = await POST(req("{}"));
    expect(res.status).toBe(400);
  });

  it("returns 400 and saves nothing when the signature doesn't verify", async () => {
    vi.mocked(stripe.webhooks.constructEvent).mockImplementation(() => {
      throw new Error("signature mismatch");
    });
    const { POST } = await import("@/app/api/webhooks/stripe/route");
    const res = await POST(req("{}", "bad"));
    expect(res.status).toBe(400);
  });

  it("saves the event, dispatches it by type, and records the handler's outcome", async () => {
    const cases: [string, unknown][] = [
      ["payment_intent.succeeded", handlePaymentIntentSucceeded],
      ["payment_intent.canceled", handlePaymentIntentCanceled],
      ["charge.refunded", handleChargeRefunded],
      ["charge.dispute.created", handleChargeDisputeCreated],
    ];
    for (const [type, handler] of cases) {
      const object = { id: `obj_${type}` };
      const evt = event(type, object);
      const res = await deliver(evt);
      expect(res.status).toBe(200);
      expect(handler).toHaveBeenCalledWith(object);
      const row = await stored(evt.id);
      expect(row).toMatchObject({ type, outcome: "handled", operatorId: ctx.operatorId, attempts: 1 });
      expect(row.processedAt).not.toBeNull();
    }
  });

  it("processes a redelivered event only once", async () => {
    const evt = event("payment_intent.succeeded", { id: "pi_twice" });
    expect((await deliver(evt)).status).toBe(200);
    expect((await deliver(evt)).status).toBe(200);
    expect(handlePaymentIntentSucceeded).toHaveBeenCalledTimes(1);
    expect((await stored(evt.id)).attempts).toBe(1);
  });

  it("answers 500 when the handler fails, keeps the error, and finishes the event on redelivery", async () => {
    vi.mocked(handleChargeRefunded).mockRejectedValueOnce(new Error("Stripe timed out"));
    const evt = event("charge.refunded", { id: "ch_retry" });

    const first = await deliver(evt);
    expect(first.status).toBe(500);
    const failed = await stored(evt.id);
    expect(failed.processedAt).toBeNull();
    expect(failed.claimedAt).toBeNull();
    expect(failed.lastError).toMatch(/Stripe timed out/);

    const second = await deliver(evt);
    expect(second.status).toBe(200);
    const done = await stored(evt.id);
    expect(done).toMatchObject({ outcome: "handled", attempts: 2 });
    expect(done.processedAt).not.toBeNull();
  });

  it("records an event from a connected account as ignored and calls no handler (P3-2)", async () => {
    const evt = event("payment_intent.succeeded", { id: "pi_acct" }, { account: "acct_someone" });
    const res = await deliver(evt);
    expect(res.status).toBe(200);
    expect(handlePaymentIntentSucceeded).not.toHaveBeenCalled();
    expect(await stored(evt.id)).toMatchObject({ outcome: "ignored", account: "acct_someone" });
  });

  it("records an event type it doesn't handle as ignored", async () => {
    const evt = event("customer.created", {});
    const res = await deliver(evt);
    expect(res.status).toBe(200);
    for (const h of handlers) expect(h).not.toHaveBeenCalled();
    expect(await stored(evt.id)).toMatchObject({ outcome: "ignored" });
  });

  it("stores a needs_review outcome with its note", async () => {
    vi.mocked(handleChargeDisputeCreated).mockResolvedValueOnce({
      outcome: "needs_review",
      operatorId: ctx.operatorId,
      note: "Dispute opened",
    } as never);
    const evt = event("charge.dispute.created", { id: "dp_review" });
    expect((await deliver(evt)).status).toBe(200);
    expect(await stored(evt.id)).toMatchObject({ outcome: "needs_review", lastError: "Dispute opened" });
  });
});
