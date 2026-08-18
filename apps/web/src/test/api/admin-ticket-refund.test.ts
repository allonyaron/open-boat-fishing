import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";
import { seedOperator, cleanupOperator, testDb } from "../db-helpers";
import type { SeedResult } from "../db-helpers";
import { bookings, bookingItems, tickets, payments, trips } from "@openboat/db";
import { eq } from "drizzle-orm";
import { randomUUID } from "crypto";

vi.mock("@/lib/session", () => ({
  requireAdmin: vi.fn(),
}));

vi.mock("@/lib/stripe", () => ({
  stripe: {
    refunds: {
      create: vi.fn().mockResolvedValue({ id: "re_test_mock" }),
    },
    applicationFees: {
      createRefund: vi.fn().mockResolvedValue({ id: "afe_test_mock" }),
    },
  },
}));

import { requireAdmin } from "@/lib/session";
import { stripe } from "@/lib/stripe";

let ctx: SeedResult;

beforeAll(async () => {
  ctx = await seedOperator();
});

afterAll(async () => {
  await cleanupOperator(ctx.operatorId);
});

beforeEach(() => {
  vi.mocked(requireAdmin).mockResolvedValue({
    session: { staffId: ctx.staffId, operatorId: ctx.operatorId, role: "admin" as const, name: "Admin" },
  } as any);
  vi.mocked(stripe.refunds.create).mockResolvedValue({ id: "re_test_mock" } as any);
});

async function seedRefundableBooking(opts: { voided?: boolean } = {}) {
  const piId = `pi_test_${randomUUID().slice(0, 8)}`;
  const [booking] = await testDb
    .insert(bookings)
    .values({
      operatorId: ctx.operatorId,
      confirmationCode: randomUUID().slice(0, 6).toUpperCase(),
      status: "confirmed",
      totalCents: 10000,
      platformFeeCents: 150,
      customerEmail: `test-${randomUUID().slice(0, 6)}@test.com`,
      stripePaymentIntentId: piId,
      holdExpiresAt: new Date(Date.now() - 60_000),
    })
    .returning({ id: bookings.id });

  const [item] = await testDb
    .insert(bookingItems)
    .values({
      bookingId: booking.id,
      tripId: ctx.tripId,
      operatorId: ctx.operatorId,
      subtotalCents: 10000,
    })
    .returning({ id: bookingItems.id });

  const [ticket] = await testDb
    .insert(tickets)
    .values({
      bookingItemId: item.id,
      bookingId: booking.id,
      operatorId: ctx.operatorId,
      ticketType: "adult",
      priceCents: 10000,
      feeAmountCents: 150,
      qrPayload: randomUUID(),
      voided: opts.voided ?? false,
    })
    .returning({ id: tickets.id });

  await testDb.insert(payments).values({
    bookingId: booking.id,
    operatorId: ctx.operatorId,
    stripePaymentIntentId: piId,
    amountCents: 10000,
    applicationFeeCents: 150,
    status: "succeeded",
  });

  return { bookingId: booking.id, ticketId: ticket.id };
}

function postReq(ticketId: string) {
  return new NextRequest(`http://localhost/api/admin/tickets/${ticketId}/refund`, {
    method: "POST",
    headers: { "content-type": "application/json" },
  });
}

describe("POST /api/admin/tickets/[ticketId]/refund", () => {
  it("returns 401 when not authenticated", async () => {
    vi.mocked(requireAdmin).mockResolvedValueOnce(
      NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    );
    const { POST } = await import("@/app/api/admin/tickets/[ticketId]/refund/route");
    const res = await POST(postReq("any-id"), { params: { ticketId: "any-id" } });
    expect(res.status).toBe(401);
  });

  it("returns 404 for unknown ticketId", async () => {
    const fakeId = "00000000-0000-0000-0000-000000000000";
    const { POST } = await import("@/app/api/admin/tickets/[ticketId]/refund/route");
    const res = await POST(postReq(fakeId), { params: { ticketId: fakeId } });
    expect(res.status).toBe(404);
  });

  it("returns 409 when ticket is already voided", async () => {
    const { ticketId } = await seedRefundableBooking({ voided: true });
    const { POST } = await import("@/app/api/admin/tickets/[ticketId]/refund/route");
    const res = await POST(postReq(ticketId), { params: { ticketId } });
    expect(res.status).toBe(409);
  });

  it("returns 200, voids ticket, restores seat, and calls Stripe", async () => {
    const [tripBefore] = await testDb
      .select({ seatsRemaining: trips.seatsRemaining })
      .from(trips)
      .where(eq(trips.id, ctx.tripId));

    const { ticketId } = await seedRefundableBooking();

    const { POST } = await import("@/app/api/admin/tickets/[ticketId]/refund/route");
    const res = await POST(postReq(ticketId), { params: { ticketId } });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.ticketId).toBe(ticketId);
    expect(body.refundedCents).toBe(10000);

    expect(stripe.refunds.create).toHaveBeenCalledWith(
      expect.objectContaining({ payment_intent: expect.stringContaining("pi_test_") }),
    );

    const [updatedTicket] = await testDb
      .select({ voided: tickets.voided })
      .from(tickets)
      .where(eq(tickets.id, ticketId));
    expect(updatedTicket.voided).toBe(true);

    const [tripAfter] = await testDb
      .select({ seatsRemaining: trips.seatsRemaining })
      .from(trips)
      .where(eq(trips.id, ctx.tripId));
    expect(tripAfter.seatsRemaining).toBe(tripBefore.seatsRemaining + 1);
  });
});
