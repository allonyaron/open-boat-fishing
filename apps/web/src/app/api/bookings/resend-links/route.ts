import { NextRequest, NextResponse } from "next/server";
import { waitUntil } from "@vercel/functions";
import { z } from "zod";
import { getOperatorId } from "@/lib/operator";
import { checkRateLimit, clientIp, tooManyRequests } from "@/lib/rate-limit";
import { sendBookingLinks } from "@/lib/bookings/resend-links";

// POST /api/bookings/resend-links  { email }
// Emails the address its bookings' boarding-pass links (row 15). The answer is
// the same whether or not anything is found, and the lookup and the send run
// after it, so neither the body nor the timing says whether a booking exists.
// A POST, so the address never sits in a URL.

const IP_MAX = 10;
const IP_WINDOW_MS = 15 * 60 * 1000;
// Per address, so the form can't be used to flood someone's inbox.
const EMAIL_MAX = 3;
const EMAIL_WINDOW_MS = 60 * 60 * 1000;

const Body = z.object({ email: z.string().trim().toLowerCase().email().max(254) });

export async function POST(req: NextRequest) {
  const opId = getOperatorId(req) ?? "unknown";
  const ipCheck = await checkRateLimit(`resend-links:${opId}:ip:${clientIp(req)}`, IP_MAX, IP_WINDOW_MS);
  if (!ipCheck.allowed) return tooManyRequests(ipCheck.retryAfterSec);

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Enter a valid email address" }, { status: 400 });
  const { email } = parsed.data;

  const emailCheck = await checkRateLimit(`resend-links:${opId}:email:${email}`, EMAIL_MAX, EMAIL_WINDOW_MS);
  if (!emailCheck.allowed) return tooManyRequests(emailCheck.retryAfterSec);

  const operatorId = getOperatorId(req);
  if (operatorId) {
    waitUntil(
      sendBookingLinks(operatorId, email).catch((err) => console.error("[resend-links] send failed", err)),
    );
  }
  return NextResponse.json({ ok: true });
}
