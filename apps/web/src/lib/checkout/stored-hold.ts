// The checkout's pending booking, kept in sessionStorage so it outlives the
// page: a reload resumes it, and leaving checkout by any route (Back, a nav
// link, the home page) releases it on the next page load (P2-3).
//
// sessionStorage is per tab, so another tab browsing trips usually can't
// release this checkout. A duplicated tab copies it, though; if that copy
// releases the hold, this checkout's confirm fails with
// payment_intent_unexpected_state and the customer books again. No charge
// can land on a released booking: its PI is canceled first.

import type { EnrichedCartItem } from "@/components/BookingCalendar";

const KEY = "openboat_checkout_hold";

export type StoredHold = {
  bookingId: string;
  clientSecret: string;
  confirmationCode: string;
  holdExpiresAt: string;
  /** Proves this tab owns the booking: sent on extend-hold, contact and release. */
  holdToken: string;
  /** cartKey() of the cart this booking was made for. */
  cartKey: string;
};

/** A stable fingerprint of what the cart holds, to tell whether the booking still matches it. */
export function cartKey(items: EnrichedCartItem[]): string {
  return items
    .flatMap((item) => item.tickets.map((t) => `${item.tripId}:${t.ticketType}:${t.quantity}`))
    .sort()
    .join(",");
}

export function loadHold(): StoredHold | null {
  try {
    const raw = sessionStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as StoredHold) : null;
  } catch {
    return null;
  }
}

export function saveHold(hold: StoredHold) {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(hold));
  } catch {
    /* storage unavailable: the hold just won't survive a reload */
  }
}

export function clearHold() {
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}

export function isLive(hold: StoredHold): boolean {
  return new Date(hold.holdExpiresAt).getTime() > Date.now();
}

export function holdHeaders(hold: StoredHold): Record<string, string> {
  return { "X-Hold-Token": hold.holdToken };
}

/**
 * Gives the booking's seats back. "paid" means its payment went through after
 * all, and nothing was released. A network failure counts as released: the
 * hold expires on its own, and the next booking on the trip reclaims it.
 * keepalive lets the request finish if the page is navigating away.
 */
export async function releaseHold(hold: StoredHold): Promise<"released" | "paid"> {
  try {
    const res = await fetch(`/api/bookings/${hold.bookingId}/release`, {
      method: "POST",
      headers: holdHeaders(hold),
      keepalive: true,
    });
    if (res.status === 409) return "paid";
  } catch {
    /* see above */
  }
  return "released";
}

/** Where to send a customer whose booking turns out to be paid. */
export function confirmationUrl(hold: Pick<StoredHold, "confirmationCode">): string {
  return `/booking/confirmation?code=${encodeURIComponent(hold.confirmationCode)}`;
}
