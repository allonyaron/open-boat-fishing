import { createHmac, timingSafeEqual } from "crypto";

// A booking key opens a booking's customer pages: the confirmation page and
// the boarding passes (P8-1). Neither the confirmation code nor the booking id
// is enough on its own. The code is 6 hex characters, so it can be guessed;
// the id sits in Stripe metadata, in the hold endpoints' paths and in logs.
//
// The key is an HMAC of the operator and booking ids. It goes only to the
// customer: in the confirmation email's link, and on the confirmation page
// once checkout has proven it paid with its PaymentIntent's client secret.
//
// The MAC input starts with "booking-key:", and a colon never appears in the
// base64url payloads that customer, mate and hold tokens sign, so none of those
// signatures can stand in for a key.

/** How long after a booking's last trip ends its links keep opening. */
export const BOOKING_LINK_DAYS_AFTER_TRIP = 14;

export function bookingKey(operatorId: string, bookingId: string): string {
  return createHmac("sha256", process.env.SESSION_SECRET!)
    .update(`booking-key:${operatorId}:${bookingId}`)
    .digest("base64url");
}

/** True only for this booking's key under this operator. */
export function verifyBookingKey(key: unknown, operatorId: string, bookingId: string): boolean {
  if (typeof key !== "string") return false;
  const given = Buffer.from(key);
  const expected = Buffer.from(bookingKey(operatorId, bookingId));
  return given.length === expected.length && timingSafeEqual(given, expected);
}

/** Whether a booking's links still open, given when its last trip ends. */
export function bookingLinksOpen(lastTripEndsAt: Date, now: Date = new Date()): boolean {
  return now.getTime() <= lastTripEndsAt.getTime() + BOOKING_LINK_DAYS_AFTER_TRIP * 24 * 60 * 60 * 1000;
}

export function boardingPassPath(operatorId: string, bookingId: string): string {
  return `/boarding/${bookingId}?k=${bookingKey(operatorId, bookingId)}`;
}

export function confirmationPagePath(confirmationCode: string, operatorId: string, bookingId: string): string {
  return `/booking/confirmation?code=${encodeURIComponent(confirmationCode)}&k=${bookingKey(operatorId, bookingId)}`;
}
