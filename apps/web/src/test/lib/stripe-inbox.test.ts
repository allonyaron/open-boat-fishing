// Row 10: the Stripe event inbox. Events are saved once, processed once,
// retried while a handler fails, and given up as needs_review three days after
// Stripe created them. The dispatcher is a stub here.
import { describe, it, expect, afterAll, vi } from "vitest";
import { randomUUID } from "crypto";
import { testDb } from "../db-helpers";
import { stripeEvents } from "@openboat/db";
import { eq, inArray } from "drizzle-orm";
import {
  CLAIM_LEASE_MS,
  GIVE_UP_AFTER_MS,
  drainEvents,
  processEvent,
  recordEvent,
  type EventDispatcher,
} from "@/lib/stripe-events/inbox";

const ids: string[] = [];

afterAll(async () => {
  if (ids.length) await testDb.delete(stripeEvents).where(inArray(stripeEvents.id, ids));
});

function evt(createdAt: Date, type = "charge.refunded") {
  const id = `evt_inbox_${randomUUID().replace(/-/g, "").slice(0, 16)}`;
  ids.push(id);
  return {
    id,
    type,
    created: Math.floor(createdAt.getTime() / 1000),
    livemode: false,
    data: { object: { id: `obj_${id}` } },
  } as never;
}

async function row(id: string) {
  const [r] = await testDb.select().from(stripeEvents).where(eq(stripeEvents.id, id));
  return r;
}

const handled: EventDispatcher = async () => ({ outcome: "handled" });

describe("recordEvent", () => {
  it("saves an event once; a redelivery changes nothing", async () => {
    const e = evt(new Date()) as { id: string };
    await recordEvent(e as never);
    await recordEvent(e as never);
    const rows = await testDb.select().from(stripeEvents).where(eq(stripeEvents.id, e.id));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ type: "charge.refunded", attempts: 0, processedAt: null });
  });
});

describe("processEvent", () => {
  it("skips an event another worker has claimed until the lease runs out", async () => {
    const now = new Date();
    const e = evt(now) as { id: string };
    await recordEvent(e as never);
    await testDb.update(stripeEvents).set({ claimedAt: now }).where(eq(stripeEvents.id, e.id));

    const dispatch = vi.fn(handled);
    expect(await processEvent(e.id, dispatch, new Date(now.getTime() + 1000))).toBe("busy");
    expect(dispatch).not.toHaveBeenCalled();

    const later = new Date(now.getTime() + CLAIM_LEASE_MS + 1000);
    expect(await processEvent(e.id, dispatch, later)).toBe("processed");
    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(await processEvent(e.id, dispatch, later)).toBe("done");
  });

  it("gives up as needs_review once the event is older than three days", async () => {
    const created = new Date(Date.now() - GIVE_UP_AFTER_MS - 60_000);
    const e = evt(created) as { id: string };
    await recordEvent(e as never);
    const failing: EventDispatcher = async () => {
      throw new Error("still broken");
    };
    expect(await processEvent(e.id, failing)).toBe("processed");
    const r = await row(e.id);
    expect(r.outcome).toBe("needs_review");
    expect(r.processedAt).not.toBeNull();
    expect(r.lastError).toMatch(/Gave up.*still broken/);
  });
});

describe("drainEvents", () => {
  it("processes unfinished events oldest first and leaves failing ones for the next run", async () => {
    const t = Date.now();
    const older = evt(new Date(t - 3 * 60_000)) as { id: string };
    const newer = evt(new Date(t - 60_000)) as { id: string };
    const broken = evt(new Date(t - 2 * 60_000)) as { id: string };
    for (const e of [newer, broken, older]) await recordEvent(e as never);

    const order: string[] = [];
    const dispatch: EventDispatcher = async (event) => {
      order.push(event.id);
      if (event.id === broken.id) throw new Error("not yet");
      return { outcome: "handled" };
    };
    const result = await drainEvents(dispatch, { limit: 500 });

    const mine = order.filter((id) => [older.id, newer.id, broken.id].includes(id));
    expect(mine).toEqual([older.id, broken.id, newer.id]);
    expect(result.retry).toBeGreaterThanOrEqual(1);
    expect((await row(older.id)).outcome).toBe("handled");
    expect((await row(newer.id)).outcome).toBe("handled");
    const b = await row(broken.id);
    expect(b.processedAt).toBeNull();
    expect(b.lastError).toMatch(/not yet/);
  });
});
