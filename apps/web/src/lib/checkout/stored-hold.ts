// The checkout's pending booking, kept in sessionStorage so it outlives the
// page: a reload resumes it, and leaving checkout by any route (Back, a nav
// link, the home page) releases it on the next page load (P2-3).
//
// sessionStorage is per tab, so another tab browsing trips usually can't
// release this checkout. A duplicated tab copies it, though; if that copy
// releases the hold, this checkout's confirm fails with
// payment_intent_unexpected_state and the customer books again. No charge
// can land on a released booking: its PI is canceled first.

export { cartKey } from "@openboat/utils";

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
  /**
   * The booking's totalCents: its PaymentIntent's amount, which is what a
   * confirm charges. Missing on holds saved before P8-3; those aren't resumed.
   */
  totalCents?: number;
};

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
 * Gives the booking's seats back.
 * - "released": done, or nothing left to release (gone, or the token expired
 *   with the hold).
 * - "paid": its payment went through after all; nothing was released.
 * - "failed": no answer, or the server couldn't reach Stripe. Keep the hold
 *   saved: the next page retries, and the next booking sends it as replaces.
 * keepalive lets the request finish if the page is navigating away.
 */
export async function releaseHold(hold: StoredHold): Promise<"released" | "paid" | "failed"> {
  try {
    const res = await fetch(`/api/bookings/${hold.bookingId}/release`, {
      method: "POST",
      headers: holdHeaders(hold),
      keepalive: true,
    });
    if (res.status === 409) return "paid";
    if (res.status === 429 || res.status >= 500) return "failed";
    return "released";
  } catch {
    return "failed";
  }
}

/** Where to send a customer whose booking turns out to be paid. */
export function confirmationUrl(hold: Pick<StoredHold, "confirmationCode">): string {
  return `/booking/confirmation?code=${encodeURIComponent(hold.confirmationCode)}`;
}
