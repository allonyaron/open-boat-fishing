import { createHmac, timingSafeEqual } from "crypto";
import { NextRequest, NextResponse } from "next/server";

// Proof that the caller is the checkout that created a pending booking. The
// booking id alone isn't enough to change a hold: it sits in Stripe metadata
// and boarding-pass URLs, and the contact endpoint can redirect the
// confirmation email. POST /api/bookings returns this token; extend-hold,
// contact and release require it in the X-Hold-Token header.
//
// Same HMAC-SHA256 scheme as the customer and mate tokens, with its own
// audience so none of the three can stand in for another (M6).

export const HOLD_TOKEN_HEADER = "x-hold-token";

// A hold can't outlive 90 minutes from creation (extend-hold's cap), so
// neither does its token.
export const HOLD_TOKEN_TTL_MS = 90 * 60 * 1000;

type HoldTokenPayload = { bookingId: string; operatorId: string };

function sign(data: string): string {
  return createHmac("sha256", process.env.SESSION_SECRET!).update(data).digest("base64url");
}

export function signHoldToken(payload: HoldTokenPayload, createdAt: Date = new Date()): string {
  const exp = Math.floor((createdAt.getTime() + HOLD_TOKEN_TTL_MS) / 1000);
  const data = Buffer.from(JSON.stringify({ ...payload, aud: "hold", exp })).toString("base64url");
  return `${data}.${sign(data)}`;
}

/** True only for an unexpired hold token issued for this booking and operator. */
export function verifyHoldToken(token: string, bookingId: string, operatorId: string): boolean {
  const dot = token.lastIndexOf(".");
  if (dot < 0) return false;
  const data = token.slice(0, dot);
  const sig = Buffer.from(token.slice(dot + 1));
  const expected = Buffer.from(sign(data));
  if (sig.length !== expected.length || !timingSafeEqual(sig, expected)) return false;

  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(Buffer.from(data, "base64url").toString());
  } catch {
    return false;
  }
  return (
    payload.aud === "hold" &&
    typeof payload.exp === "number" &&
    payload.exp >= Date.now() / 1000 &&
    payload.bookingId === bookingId &&
    payload.operatorId === operatorId
  );
}

/** Returns a 401 response unless the request carries a valid hold token. */
export function requireHoldToken(
  req: NextRequest,
  bookingId: string,
  operatorId: string,
): NextResponse | null {
  const token = req.headers.get(HOLD_TOKEN_HEADER);
  if (token && verifyHoldToken(token, bookingId, operatorId)) return null;
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}
