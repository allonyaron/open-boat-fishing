// Row 11: a chargeback fee the operator owes rides on the platform fee of
// their next booking. Reserved at checkout, collected when the payment
// succeeds, owed again when the booking is cancelled unpaid.
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { seedOperator, setTripDeparture, cleanupOperator, seedBooking, testDb } from "../db-helpers";
import type { SeedResult } from "../db-helpers";
import { bookings, operatorDebts, operators } from "@openboat/db";
import { eq } from "drizzle-orm";

vi.mock("@/lib/stripe", () => ({
  stripe: { paymentIntents: { create: vi.fn() } },
}));

import { stripe } from "@/lib/stripe";
import { db } from "@/lib/db";
import { POST } from "@/app/api/bookings/route";
import { cancelPendingBooking } from "@/lib/bookings/cancel";
import { collectDebts, reserveDebts } from "@/lib/payments/operator-debts";

let ctx: SeedResult;
let ip = 0;

beforeAll(async () => {
  ctx = await seedOperator();
  await testDb
    .update(operators)
    .set({ stripeAccountId: "acct_debts", stripeOnboardingComplete: true })
    .where(eq(operators.id, ctx.operatorId));
  await setTripDeparture(ctx.tripId, 3 * 3_600_000);
});

afterAll(async () => {
  await cleanupOperator(ctx.operatorId);
});

beforeEach(async () => {
  await testDb.delete(operatorDebts).where(eq(operatorDebts.operatorId, ctx.operatorId));
  vi.mocked(stripe.paymentIntents.create).mockReset();
  vi.mocked(stripe.paymentIntents.create).mockResolvedValue({ id: `pi_debt_${ip}`, client_secret: "s" } as any);
});

async function owe(amountCents: number) {
  const [row] = await testDb
    .insert(operatorDebts)
    .values({ operatorId: ctx.operatorId, kind: "dispute_fee", amountCents })
    .returning();
  return row;
}

async function debt(id: string) {
  const [row] = await testDb.select().from(operatorDebts).where(eq(operatorDebts.id, id));
  return row;
}

function book() {
  return POST(
    new NextRequest("http://localhost/api/bookings", {
      method: "POST",
      body: JSON.stringify({
        customerEmail: "debt@test.com",
        customerPhone: "5555550100",
        cart: [{ tripId: ctx.tripId, tickets: [{ ticketType: "adult", quantity: 1 }] }],
      }),
      headers: { "Content-Type": "application/json", "x-operator-id": ctx.operatorId, "x-forwarded-for": `10.9.0.${++ip}` },
    }),
  );
}

describe("checkout", () => {
  it("adds an owed chargeback fee to the booking's platform fee, not to what the customer pays", async () => {
    const owed = await owe(1500);
    const res = await book();
    expect(res.status).toBe(200);
    const body = await res.json();

    const [b] = await testDb.select().from(bookings).where(eq(bookings.id, body.bookingId));
    const params = vi.mocked(stripe.paymentIntents.create).mock.lastCall![0]!;
    expect(params.amount).toBe(b.totalCents);
    expect(params.application_fee_amount).toBe(b.platformFeeCents + 1500);
    expect(params.metadata).toMatchObject({ chargebackFeesCollectedCents: "1500" });
    expect(await debt(owed.id)).toMatchObject({ status: "reserved", bookingId: body.bookingId });
  });

  it("charges the normal fee when nothing is owed", async () => {
    const res = await book();
    const body = await res.json();
    const [b] = await testDb.select().from(bookings).where(eq(bookings.id, body.bookingId));
    const params = vi.mocked(stripe.paymentIntents.create).mock.lastCall![0]!;
    expect(params.application_fee_amount).toBe(b.platformFeeCents);
    expect(params.metadata).not.toHaveProperty("chargebackFeesCollectedCents");
  });

  it("releases the reservation when the PaymentIntent can't be created", async () => {
    const owed = await owe(1500);
    vi.mocked(stripe.paymentIntents.create).mockRejectedValueOnce(new Error("Stripe down"));
    expect((await book()).status).toBe(502);
    expect(await debt(owed.id)).toMatchObject({ status: "owed", bookingId: null });
  });
});

describe("reserveDebts / collectDebts / release", () => {
  it("reserves the oldest debts that fit and skips one that doesn't", async () => {
    const a = await owe(1500);
    const big = await owe(9000);
    const c = await owe(1500);
    const { bookingId } = await seedBooking(ctx, { status: "pending" });
    const reserved = await db.transaction((tx) =>
      reserveDebts(tx, { operatorId: ctx.operatorId, bookingId, roomCents: 5000 }),
    );
    expect(reserved).toBe(3000);
    expect((await debt(a.id)).status).toBe("reserved");
    expect((await debt(big.id)).status).toBe("owed");
    expect((await debt(c.id)).status).toBe("reserved");
  });

  it("collects on payment and owes again when the booking is cancelled unpaid", async () => {
    const paidDebt = await owe(1500);
    const paid = await seedBooking(ctx, { status: "pending" });
    await db.transaction(async (tx) => {
      await reserveDebts(tx, { operatorId: ctx.operatorId, bookingId: paid.bookingId, roomCents: 9000 });
      await collectDebts(tx, { operatorId: ctx.operatorId, bookingId: paid.bookingId });
    });
    expect(await debt(paidDebt.id)).toMatchObject({ status: "collected", bookingId: paid.bookingId });
    expect((await debt(paidDebt.id)).collectedAt).not.toBeNull();

    const unpaidDebt = await owe(1500);
    const unpaid = await seedBooking(ctx, { status: "pending" });
    await db.transaction((tx) =>
      reserveDebts(tx, { operatorId: ctx.operatorId, bookingId: unpaid.bookingId, roomCents: 9000 }),
    );
    await cancelPendingBooking(unpaid.bookingId);
    expect(await debt(unpaidDebt.id)).toMatchObject({ status: "owed", bookingId: null });
    // A collected debt stays collected.
    expect((await debt(paidDebt.id)).status).toBe("collected");
  });
});
