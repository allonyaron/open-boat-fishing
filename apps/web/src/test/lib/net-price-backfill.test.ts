// Row 8, migration 0017: tickets written before list_price_cents existed hold
// their fare in price_cents. The backfill keeps the fare as list_price_cents
// and makes price_cents what the ticket paid, sharing the item's discount in
// proportion to the fares. CI migrates an empty database, so this runs the
// backfill statement itself against legacy-shaped rows.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { readFileSync } from "fs";
import { randomUUID } from "crypto";
import { seedOperator, cleanupOperator, cleanupBookings, testDb } from "../db-helpers";
import type { SeedResult } from "../db-helpers";
import { bookings, bookingItems, tickets } from "@openboat/db";
import { inArray, sql } from "drizzle-orm";

const MIGRATION = new URL(
  "../../../../../packages/db/migrations/0017_seat_ledger_net_price.sql",
  import.meta.url,
);

function backfillStatement(): string {
  const stmt = readFileSync(MIGRATION, "utf8")
    .split("--> statement-breakpoint")
    .find((s) => s.includes('WITH "base"'));
  if (!stmt) throw new Error("backfill statement not found in 0017");
  return stmt;
}

let ctx: SeedResult;

beforeAll(async () => {
  ctx = await seedOperator();
});

afterAll(async () => {
  await cleanupBookings(ctx.tripId);
  await cleanupOperator(ctx.operatorId);
});

type LegacyTicket = { ticketType: "adult" | "child" | "senior"; fare: number; listPriceCents?: number };

/** A booking item and its tickets as code before 0017 wrote them: price_cents = fare. */
async function legacyItem(subtotalCents: number, ticketsIn: LegacyTicket[]) {
  const [booking] = await testDb
    .insert(bookings)
    .values({
      operatorId: ctx.operatorId,
      confirmationCode: randomUUID().slice(0, 6).toUpperCase(),
      status: "confirmed",
      totalCents: subtotalCents,
      platformFeeCents: 150 * ticketsIn.length,
      customerEmail: `bf-${randomUUID().slice(0, 6)}@test.com`,
    })
    .returning({ id: bookings.id });
  const [item] = await testDb
    .insert(bookingItems)
    .values({ bookingId: booking.id, tripId: ctx.tripId, operatorId: ctx.operatorId, subtotalCents })
    .returning({ id: bookingItems.id });
  const rows = await testDb
    .insert(tickets)
    .values(
      ticketsIn.map((t) => ({
        bookingItemId: item.id,
        bookingId: booking.id,
        operatorId: ctx.operatorId,
        ticketType: t.ticketType,
        priceCents: t.fare,
        listPriceCents: t.listPriceCents ?? null,
        status: "live" as const,
        qrPayload: randomUUID(),
      })),
    )
    .returning({ id: tickets.id });
  return rows.map((r) => r.id);
}

async function prices(ids: string[]) {
  const rows = await testDb
    .select({ id: tickets.id, priceCents: tickets.priceCents, listPriceCents: tickets.listPriceCents })
    .from(tickets)
    .where(inArray(tickets.id, ids));
  return ids.map((id) => rows.find((r) => r.id === id)!);
}

describe("0017 net-price backfill", () => {
  it("leaves mixed fares alone when there is no discount", async () => {
    const ids = await legacyItem(15000, [
      { ticketType: "adult", fare: 10000 },
      { ticketType: "child", fare: 5000 },
    ]);
    await testDb.execute(sql.raw(backfillStatement()));
    expect(await prices(ids)).toEqual([
      { id: ids[0], priceCents: 10000, listPriceCents: 10000 },
      { id: ids[1], priceCents: 5000, listPriceCents: 5000 },
    ]);
  });

  it("shares a discount in proportion to the fares", async () => {
    // 10% off $150: $15 off, $10 on the adult and $5 on the child.
    const ids = await legacyItem(13500, [
      { ticketType: "adult", fare: 10000 },
      { ticketType: "child", fare: 5000 },
    ]);
    await testDb.execute(sql.raw(backfillStatement()));
    expect((await prices(ids)).map((p) => p.priceCents)).toEqual([9000, 4500]);
  });

  it("gives leftover cents to one ticket so the shares sum to the subtotal", async () => {
    const ids = await legacyItem(2900, [
      { ticketType: "adult", fare: 1000 },
      { ticketType: "adult", fare: 1000 },
      { ticketType: "adult", fare: 1000 },
    ]);
    await testDb.execute(sql.raw(backfillStatement()));
    const nets = (await prices(ids)).map((p) => p.priceCents);
    expect(nets.reduce((s, n) => s + n, 0)).toBe(2900);
    expect([...nets].sort()).toEqual([966, 967, 967]);
  });

  it("does not touch tickets that already have a list price, and a second run changes nothing", async () => {
    const written = await legacyItem(13500, [
      { ticketType: "adult", fare: 9000, listPriceCents: 10000 },
      { ticketType: "child", fare: 4500, listPriceCents: 5000 },
    ]);
    const legacy = await legacyItem(13500, [
      { ticketType: "adult", fare: 10000 },
      { ticketType: "child", fare: 5000 },
    ]);
    await testDb.execute(sql.raw(backfillStatement()));
    const once = await prices([...written, ...legacy]);
    await testDb.execute(sql.raw(backfillStatement()));
    expect(await prices([...written, ...legacy])).toEqual(once);
    expect(once.map((p) => p.priceCents)).toEqual([9000, 4500, 9000, 4500]);
  });
});
