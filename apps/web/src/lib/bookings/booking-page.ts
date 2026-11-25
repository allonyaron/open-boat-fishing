import "server-only";
import { timingSafeEqual } from "crypto";
import { and, eq, max } from "drizzle-orm";
import { bookingItems, bookings, trips } from "@openboat/db";
import { db } from "@/lib/db";
import { stripe } from "@/lib/stripe";
import { bookingLinksOpen, confirmationPagePath, verifyBookingKey } from "./booking-key";
import { getConfirmedBooking, type ConfirmedBooking } from "./get-confirmed-booking";

// What the confirmation page may show to one visit (P8-1).
//
// A visit opens the booking with one of two credentials:
// - the booking key (`k`), from the confirmation email or an earlier visit;
// - the PaymentIntent's id and client secret, which Stripe appends to the
//   checkout's return_url and the checkout tab keeps in its saved hold. The
//   client secret is checked against Stripe, then the visit is redirected to
//   the key URL, so the secret leaves the address bar and a reload or the
//   processing screen's polling doesn't call Stripe to re-check it.
//
// Anything else, a confirmation code alone included, is "locked" without a
// database read, so the page can't tell anyone whether a code exists.
// `redirect_status` is never read: whether the booking is paid comes from its
// status, which only the verified payment_intent.succeeded webhook confirms.

export type BookingPageParams = {
  code?: string;
  k?: string;
  payment_intent?: string;
  payment_intent_client_secret?: string;
};

export type BookingPageState =
  /** No credential, or one that doesn't open this booking. */
  | { kind: "locked" }
  /** The checkout proved it paid; continue at the booking's key URL. */
  | { kind: "redirect"; to: string }
  /** The key is right, but the booking's trips ended too long ago. */
  | { kind: "expired" }
  | { kind: "confirmed"; booking: ConfirmedBooking }
  /**
   * Pending, and Stripe has the payment (`paid`: succeeded, waiting for the
   * webhook to issue the passes) or is still working on it.
   */
  | { kind: "processing"; paid: boolean }
  /** Pending, and the payment didn't go through (or was never made). */
  | { kind: "unpaid" }
  | { kind: "cancelled" };

function sameSecret(given: string, actual: string | null): boolean {
  if (!actual) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(actual);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function resolveBookingPage(
  params: BookingPageParams,
  operatorId: string,
  arriveMinutesBefore: number | null,
  now: Date = new Date(),
): Promise<BookingPageState> {
  // A repeated query parameter arrives as an array: treat it as missing.
  const str = (v: unknown) => (typeof v === "string" && v ? v : undefined);
  const code = str(params.code);
  const k = str(params.k);
  const piId = str(params.payment_intent);
  const piSecret = str(params.payment_intent_client_secret);
  const hasPi = Boolean(piId && piSecret);
  if (!code || (!k && !hasPi)) return { kind: "locked" };

  const [booking] = await db
    .select({
      id: bookings.id,
      status: bookings.status,
      stripePaymentIntentId: bookings.stripePaymentIntentId,
    })
    .from(bookings)
    .where(and(eq(bookings.confirmationCode, code), eq(bookings.operatorId, operatorId)));
  if (!booking) return { kind: "locked" };

  if (k) {
    if (!verifyBookingKey(k, operatorId, booking.id)) return { kind: "locked" };
  } else {
    // Compare the id first, so made-up parameters never cost a Stripe call.
    if (!booking.stripePaymentIntentId || piId !== booking.stripePaymentIntentId) return { kind: "locked" };
    const intent = await stripe.paymentIntents.retrieve(booking.stripePaymentIntentId);
    if (!sameSecret(piSecret!, intent.client_secret)) return { kind: "locked" };
    return { kind: "redirect", to: confirmationPagePath(code, operatorId, booking.id) };
  }

  const [{ lastTripEndsAt }] = await db
    .select({ lastTripEndsAt: max(trips.endTime) })
    .from(bookingItems)
    .innerJoin(trips, eq(trips.id, bookingItems.tripId))
    .where(and(eq(bookingItems.bookingId, booking.id), eq(bookingItems.operatorId, operatorId)));
  if (!lastTripEndsAt || !bookingLinksOpen(new Date(lastTripEndsAt), now)) return { kind: "expired" };

  if (booking.status === "cancelled") return { kind: "cancelled" };
  if (booking.status === "confirmed") {
    const view = await getConfirmedBooking(booking.id, operatorId, arriveMinutesBefore);
    // Cancelled between the two reads.
    return view ? { kind: "confirmed", booking: view } : { kind: "cancelled" };
  }

  // Pending: ask Stripe whether the payment is on its way.
  if (!booking.stripePaymentIntentId) return { kind: "unpaid" };
  const intent = await stripe.paymentIntents.retrieve(booking.stripePaymentIntentId);
  if (intent.status === "succeeded") return { kind: "processing", paid: true };
  if (intent.status === "processing") return { kind: "processing", paid: false };
  return { kind: "unpaid" };
}
