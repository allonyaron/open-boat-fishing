import { eq } from "drizzle-orm";
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

/** The booking created with this PaymentIntent, found by its stored PI id (unique). */
export async function bookingForPaymentIntent(
  paymentIntentId: string,
): Promise<{ id: string; operatorId: string; status: "pending" | "confirmed" | "cancelled" } | null> {
  const [row] = await db
    .select({ id: bookings.id, operatorId: bookings.operatorId, status: bookings.status })
    .from(bookings)
    .where(eq(bookings.stripePaymentIntentId, paymentIntentId));
  return row ?? null;
}
