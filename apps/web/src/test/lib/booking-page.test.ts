import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { randomUUID } from "crypto";
import { eq } from "drizzle-orm";
import { bookings, trips } from "@openboat/db";
import { seedOperator, cleanupOperator, seedBooking, testDb } from "../db-helpers";
import type { SeedResult } from "../db-helpers";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/stripe", () => ({
  stripe: { paymentIntents: { retrieve: vi.fn() } },
}));

import { stripe } from "@/lib/stripe";
import { bookingKey, BOOKING_LINK_DAYS_AFTER_TRIP } from "@/lib/bookings/booking-key";
import { resolveBookingPage } from "@/lib/bookings/booking-page";

let ctx: SeedResult;
const retrieve = vi.mocked(stripe.paymentIntents.retrieve);

beforeAll(async () => {
  ctx = await seedOperator();
});

afterAll(async () => {
  await cleanupOperator(ctx.operatorId);
});

beforeEach(() => {
  retrieve.mockReset();
});

/** A booking with its own PaymentIntent id; returns its id, code and key. */
async function booking(status: "pending" | "confirmed" | "cancelled", opts: { pi?: string | null } = {}) {
  const pi = opts.pi === undefined ? `pi_${randomUUID().slice(0, 8)}` : opts.pi;
  const { bookingId } = await seedBooking(ctx, { status, stripePaymentIntentId: pi ?? undefined });
  const [row] = await testDb
    .select({ code: bookings.confirmationCode })
    .from(bookings)
    .where(eq(bookings.id, bookingId));
  return { bookingId, code: row.code, pi, key: bookingKey(ctx.operatorId, bookingId) };
}

function intent(id: string, overrides: Record<string, unknown> = {}) {
  return { id, client_secret: `${id}_secret_abc123`, status: "succeeded", ...overrides } as any;
}

const resolve = (params: Record<string, string | undefined>, now?: Date) =>
  resolveBookingPage(params, ctx.operatorId, 60, now);

describe("resolveBookingPage: who gets in", () => {
  it("a confirmation code alone opens nothing", async () => {
    const b = await booking("confirmed");
    expect(await resolve({ code: b.code })).toEqual({ kind: "locked" });
  });

  it("redirect_status=succeeded on a pending booking opens nothing (P8-1 item 2)", async () => {
    const b = await booking("pending");
    expect(await resolve({ code: b.code, redirect_status: "succeeded" })).toEqual({ kind: "locked" });
    expect(retrieve).not.toHaveBeenCalled();
  });

  it("a wrong key, or another booking's key, opens nothing", async () => {
    const b = await booking("confirmed");
    const other = await booking("confirmed");
    expect(await resolve({ code: b.code, k: "not-the-key" })).toEqual({ kind: "locked" });
    expect(await resolve({ code: b.code, k: other.key })).toEqual({ kind: "locked" });
  });

  it("a key for an unknown code opens nothing", async () => {
    const b = await booking("confirmed");
    expect(await resolve({ code: "ZZZZZZ", k: b.key })).toEqual({ kind: "locked" });
  });

  it("a booking under another operator opens nothing, key or not", async () => {
    const b = await booking("confirmed");
    const otherOperator = randomUUID();
    const state = await resolveBookingPage(
      { code: b.code, k: bookingKey(otherOperator, b.bookingId) },
      otherOperator,
      60,
    );
    expect(state).toEqual({ kind: "locked" });
  });

  it("a PaymentIntent id that isn't the booking's is refused without asking Stripe", async () => {
    const b = await booking("confirmed");
    const state = await resolve({
      code: b.code,
      payment_intent: "pi_someone_else",
      payment_intent_client_secret: "pi_someone_else_secret_x",
    });
    expect(state).toEqual({ kind: "locked" });
    expect(retrieve).not.toHaveBeenCalled();
  });

  it("the booking's PaymentIntent id with a wrong client secret is refused", async () => {
    const b = await booking("confirmed");
    retrieve.mockResolvedValue(intent(b.pi!));
    const state = await resolve({
      code: b.code,
      payment_intent: b.pi!,
      payment_intent_client_secret: `${b.pi}_secret_guess`,
    });
    expect(state).toEqual({ kind: "locked" });
  });

  it("the PaymentIntent's id and client secret redirect to the booking's key URL", async () => {
    const b = await booking("pending");
    retrieve.mockResolvedValue(intent(b.pi!));
    const state = await resolve({
      code: b.code,
      payment_intent: b.pi!,
      payment_intent_client_secret: `${b.pi}_secret_abc123`,
      redirect_status: "failed", // never read
    });
    expect(state).toEqual({ kind: "redirect", to: `/booking/confirmation?code=${b.code}&k=${b.key}` });
    expect(retrieve).toHaveBeenCalledWith(b.pi);
  });

  it("a booking with no PaymentIntent can't be opened by PaymentIntent parameters", async () => {
    const b = await booking("pending", { pi: null });
    const state = await resolve({ code: b.code, payment_intent: "pi_x", payment_intent_client_secret: "pi_x_secret_y" });
    expect(state).toEqual({ kind: "locked" });
    expect(retrieve).not.toHaveBeenCalled();
  });
});

describe("resolveBookingPage: what the key shows", () => {
  it("a confirmed booking shows the confirmation, with the keyed boarding link", async () => {
    const b = await booking("confirmed");
    const state = await resolve({ code: b.code, k: b.key });
    expect(state.kind).toBe("confirmed");
    if (state.kind !== "confirmed") return;
    expect(state.booking.confirmationCode).toBe(b.code);
    expect(state.booking.boardingPath).toBe(`/boarding/${b.bookingId}?k=${b.key}`);
    expect(retrieve).not.toHaveBeenCalled();
  });

  it("a cancelled booking says so", async () => {
    const b = await booking("cancelled");
    expect(await resolve({ code: b.code, k: b.key })).toEqual({ kind: "cancelled" });
  });

  it("a pending booking whose payment succeeded waits for the webhook", async () => {
    const b = await booking("pending");
    retrieve.mockResolvedValue(intent(b.pi!, { status: "succeeded" }));
    expect(await resolve({ code: b.code, k: b.key })).toEqual({ kind: "processing", paid: true });
  });

  it("a pending booking whose payment is processing shows processing", async () => {
    const b = await booking("pending");
    retrieve.mockResolvedValue(intent(b.pi!, { status: "processing" }));
    expect(await resolve({ code: b.code, k: b.key })).toEqual({ kind: "processing", paid: false });
  });

  it("a pending booking whose payment failed or was canceled is unpaid", async () => {
    for (const status of ["requires_payment_method", "requires_action", "canceled"]) {
      const b = await booking("pending");
      retrieve.mockResolvedValue(intent(b.pi!, { status }));
      expect(await resolve({ code: b.code, k: b.key })).toEqual({ kind: "unpaid" });
    }
  });

  it("a pending booking with no PaymentIntent is unpaid", async () => {
    const b = await booking("pending", { pi: null });
    expect(await resolve({ code: b.code, k: b.key })).toEqual({ kind: "unpaid" });
    expect(retrieve).not.toHaveBeenCalled();
  });

  it("the key stops opening the booking two weeks after its last trip", async () => {
    const b = await booking("confirmed");
    const [trip] = await testDb.select({ endTime: trips.endTime }).from(trips).where(eq(trips.id, ctx.tripId));
    const day = 24 * 60 * 60 * 1000;
    const justInside = new Date(trip.endTime.getTime() + BOOKING_LINK_DAYS_AFTER_TRIP * day);
    const justAfter = new Date(justInside.getTime() + 1000);
    expect((await resolve({ code: b.code, k: b.key }, justInside)).kind).toBe("confirmed");
    expect(await resolve({ code: b.code, k: b.key }, justAfter)).toEqual({ kind: "expired" });
  });

  it("a repeated parameter counts as missing", async () => {
    const b = await booking("confirmed");
    const state = await resolveBookingPage({ code: [b.code, b.code] as any, k: b.key }, ctx.operatorId, 60);
    expect(state).toEqual({ kind: "locked" });
  });
});
