// Row 10: the Money page's "Needs attention" list — refunds Stripe refused,
// refunds stuck before reaching Stripe, and payment events that need a person;
// with retry and "dealt with", scoped to the signed-in operator.
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { randomUUID } from "crypto";
import { seedOperator, cleanupOperator, seedBooking, testDb, adminAuth } from "../db-helpers";
import type { SeedResult } from "../db-helpers";
import { stripeCommands, stripeEvents } from "@openboat/db";
import { eq } from "drizzle-orm";

vi.mock("@/lib/stripe", () => ({
  stripe: { refunds: { create: vi.fn(), list: vi.fn() }, applicationFees: { createRefund: vi.fn() } },
}));
vi.mock("@/lib/session", () => ({ requireAdmin: vi.fn() }));

import { stripe } from "@/lib/stripe";
import { requireAdmin } from "@/lib/session";

let ctx: SeedResult;
let other: SeedResult;

beforeAll(async () => {
  ctx = await seedOperator();
  other = await seedOperator();
});

afterAll(async () => {
  await cleanupOperator(ctx.operatorId);
  await cleanupOperator(other.operatorId);
});

beforeEach(() => {
  vi.mocked(requireAdmin).mockResolvedValue(adminAuth(ctx) as never);
  vi.mocked(stripe.refunds.create).mockReset();
  vi.mocked(stripe.refunds.list).mockReset();
  vi.mocked(stripe.refunds.list).mockResolvedValue({ data: [] } as never);
});

async function command(operatorId: string, values: Partial<typeof stripeCommands.$inferInsert> = {}) {
  const id = randomUUID();
  await testDb.insert(stripeCommands).values({
    id,
    operatorId,
    kind: "refund",
    reason: "admin_ticket_refund",
    targetId: "pi_attention",
    amountCents: 4500,
    params: { payment_intent: "pi_attention", amount: 4500, metadata: { command_id: id } },
    ...values,
  });
  return id;
}

async function event(operatorId: string, values: Partial<typeof stripeEvents.$inferInsert> = {}) {
  const id = `evt_att_${randomUUID().slice(0, 12)}`;
  await testDb.insert(stripeEvents).values({
    id,
    type: "charge.dispute.created",
    livemode: false,
    stripeCreatedAt: new Date(),
    payload: {},
    processedAt: new Date(),
    outcome: "needs_review",
    operatorId,
    lastError: "Dispute opened",
    ...values,
  });
  return id;
}

async function list() {
  const { GET } = await import("@/app/api/admin/payments/attention/route");
  const res = await GET(new NextRequest("http://localhost/api/admin/payments/attention"));
  expect(res.status).toBe(200);
  return (await res.json()).items as { kind: string; id: string; canRetry: boolean; canResolve: boolean; confirmationCode: string | null }[];
}

async function act(kind: string, id: string, action: string) {
  const { POST } = await import("@/app/api/admin/payments/attention/[kind]/[id]/route");
  return POST(
    new NextRequest(`http://localhost/api/admin/payments/attention/${kind}/${id}`, {
      method: "POST",
      body: JSON.stringify({ action }),
    }),
    { params: { kind, id } },
  );
}

describe("GET /api/admin/payments/attention", () => {
  it("lists refused refunds, stuck refunds and events needing review — this operator's only", async () => {
    const { bookingId } = await seedBooking(ctx, { status: "confirmed" });
    const failed = await command(ctx.operatorId, { status: "failed", lastError: "amount_too_large", bookingId });
    const stuck = await command(ctx.operatorId, { createdAt: new Date(Date.now() - 60 * 60_000) });
    const fresh = await command(ctx.operatorId);
    const sent = await command(ctx.operatorId, { status: "sent" });
    const review = await event(ctx.operatorId);
    const handled = await event(ctx.operatorId, { outcome: "handled" });
    const othersFailed = await command(other.operatorId, { status: "failed" });

    const items = await list();
    const ids = items.map((i) => i.id);
    expect(ids).toEqual(expect.arrayContaining([failed, stuck, review]));
    for (const hidden of [fresh, sent, handled, othersFailed]) expect(ids).not.toContain(hidden);

    const f = items.find((i) => i.id === failed)!;
    expect(f).toMatchObject({ kind: "command", canRetry: true, canResolve: true });
    expect(f.confirmationCode).not.toBeNull();
    expect(items.find((i) => i.id === stuck)).toMatchObject({ canRetry: true, canResolve: false });
    expect(items.find((i) => i.id === review)).toMatchObject({ kind: "event", canRetry: false, canResolve: true });
  });
});

describe("POST /api/admin/payments/attention/:kind/:id", () => {
  it("retries a refused refund: back to pending, then sent", async () => {
    vi.mocked(stripe.refunds.create).mockResolvedValueOnce({ id: "re_retry_ok" } as never);
    const id = await command(ctx.operatorId, { status: "failed", lastError: "temporary" });
    const res = await act("command", id, "retry");
    expect(res.status).toBe(200);
    expect((await res.json()).result).toBe("sent");
    const [row] = await testDb.select().from(stripeCommands).where(eq(stripeCommands.id, id));
    expect(row).toMatchObject({ status: "sent", stripeObjectId: "re_retry_ok" });
  });

  it("marks a refused refund and an event dealt with, recording who", async () => {
    const cmd = await command(ctx.operatorId, { status: "failed" });
    const evt = await event(ctx.operatorId);
    expect((await act("command", cmd, "resolve")).status).toBe(200);
    expect((await act("event", evt, "resolve")).status).toBe(200);

    const [c] = await testDb.select().from(stripeCommands).where(eq(stripeCommands.id, cmd));
    const [e] = await testDb.select().from(stripeEvents).where(eq(stripeEvents.id, evt));
    expect(c.resolvedBy).toBe(ctx.staffId);
    expect(e.resolvedBy).toBe(ctx.staffId);
    const ids = (await list()).map((i) => i.id);
    expect(ids).not.toContain(cmd);
    expect(ids).not.toContain(evt);
  });

  it("won't mark a refund still waiting to be sent as dealt with", async () => {
    const id = await command(ctx.operatorId, { createdAt: new Date(Date.now() - 60 * 60_000) });
    expect((await act("command", id, "resolve")).status).toBe(404);
  });

  it("can't retry or resolve another operator's items", async () => {
    const cmd = await command(other.operatorId, { status: "failed" });
    const evt = await event(other.operatorId);
    expect((await act("command", cmd, "retry")).status).toBe(404);
    expect((await act("command", cmd, "resolve")).status).toBe(404);
    expect((await act("event", evt, "resolve")).status).toBe(404);
    expect(stripe.refunds.create).not.toHaveBeenCalled();
  });

  it("rejects an unknown action or kind", async () => {
    expect((await act("command", randomUUID(), "delete")).status).toBe(400);
    expect((await act("booking", randomUUID(), "resolve")).status).toBe(404);
    expect((await act("event", "evt_x", "retry")).status).toBe(400);
  });
});
