import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { bookings, operators } from "@openboat/db";

/** The connected account an object's money goes to, if any. */
export function destinationOf(obj: {
  transfer_data?: { destination?: string | { id: string } | null } | null;
  destination?: string | { id: string } | null;
}): string | null {
  const d = obj.transfer_data?.destination ?? obj.destination ?? null;
  if (!d) return null;
  return typeof d === "string" ? d : d.id;
}

/**
 * The operator in this database whose Stripe account is `accountId`, or null.
 * A payment whose destination isn't one of ours belongs to another deployment
 * that shares the platform account (local dev and previews on test keys, or
 * another client site), and its events are ignored rather than retried.
 */
export async function operatorForAccount(accountId: string | null): Promise<string | null> {
  if (!accountId) return null;
  const [row] = await db
    .select({ id: operators.id })
    .from(operators)
    .where(eq(operators.stripeAccountId, accountId));
  return row?.id ?? null;
}

/**
 * Whether an event from `eventAccount` (event.account; null for the
 * platform's own events) may act on a payment made on `paymentAccount`
 * (bookings.stripe_account_id). Payments are direct charges on the operator's
 * account (row 32), so their events must come from that same account; a
 * destination charge from before row 32 is on the platform, and its events
 * carry no account. Anything else, such as an operator's own payment on their
 * account naming a booking in its metadata, is never acted on (P3-2).
 */
export function sameAccount(eventAccount: string | null | undefined, paymentAccount: string | null | undefined): boolean {
  return (eventAccount ?? null) === (paymentAccount ?? null);
}

/** The booking created with this PaymentIntent, found by its stored PI id (unique). */
export async function bookingForPaymentIntent(paymentIntentId: string): Promise<{
  id: string;
  operatorId: string;
  status: "pending" | "confirmed" | "cancelled";
  stripeAccountId: string | null;
} | null> {
  const [row] = await db
    .select({
      id: bookings.id,
      operatorId: bookings.operatorId,
      status: bookings.status,
      stripeAccountId: bookings.stripeAccountId,
    })
    .from(bookings)
    .where(eq(bookings.stripePaymentIntentId, paymentIntentId));
  return row ?? null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Whether a payment no booking here has belongs to this deployment, and so
 * needs review, or to another one sharing the platform's Stripe account (the
 * test-mode demo shares its connected account with previews and local dev).
 *
 * `account` is the connected account the payment is on: event.account for a
 * direct charge, the destination for one from before row 32. It must be one
 * of this database's operators. Then, if the
 * payment's metadata names a booking that doesn't exist here, another
 * deployment created it. Metadata only decides between ignoring and
 * reviewing; it never confirms or cancels anything.
 */
export async function orphanPaymentOwner(
  account: string | null,
  metadata: Record<string, string> | null | undefined,
): Promise<{ ours: true; operatorId: string } | { ours: false; why: string }> {
  const operatorId = await operatorForAccount(account);
  if (!operatorId) return { ours: false, why: "not a payment of this deployment" };
  const ref = metadata?.bookingId;
  if (ref && UUID.test(ref)) {
    const [row] = await db
      .select({ id: bookings.id })
      .from(bookings)
      .where(and(eq(bookings.id, ref), eq(bookings.operatorId, operatorId)));
    if (!row) return { ours: false, why: "its booking is from another deployment sharing the Stripe account" };
  }
  return { ours: true, operatorId };
}
