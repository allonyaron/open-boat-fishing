import { randomUUID } from "crypto";
import { and, asc, eq, inArray, isNull, lt, or, sql } from "drizzle-orm";
import type Stripe from "stripe";
import { db } from "@/lib/db";
import { stripe } from "@/lib/stripe";
import { stripeCommands } from "@openboat/db";

// The Stripe command outbox (row 10, AR-6). A refund is written here in the
// same transaction as the ticket and seat changes it pays for, and sent after
// that transaction commits:
//
// - The row id is the Stripe idempotency key and the refund's
//   metadata.command_id, so a retry sends the same request, and a request
//   whose answer was lost can be found on Stripe again even after Stripe's
//   24-hour idempotency window (P4-3).
// - A network, rate-limit or server error leaves the command pending; the
//   expiry cron retries it. A request Stripe refuses is marked failed and
//   shows on the Money page.
// - A refund is "sent" once Stripe accepts it and "confirmed" when its
//   charge.refunded event arrives. A fee refund has no event and is
//   confirmed when Stripe accepts it.

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Executor = Tx | typeof db;

export const COMMAND_LEASE_MS = 5 * 60 * 1000;

export type RefundCommandInput = {
  operatorId: string;
  bookingId: string | null;
  paymentIntentId: string;
  /** Null refunds everything left on the payment. */
  amountCents: number | null;
  reason: string;
  /** Reverse the operator's transfer with the refund (destination charges). */
  reverseTransfer: boolean;
  /** Refund the platform fee in proportion. False when it is refunded separately. */
  refundApplicationFee: boolean;
  metadata?: Record<string, string>;
  dedupeKey?: string;
};

export type FeeRefundCommandInput = {
  operatorId: string;
  bookingId: string | null;
  applicationFeeId: string;
  amountCents: number | null;
  reason: string;
  metadata?: Record<string, string>;
  dedupeKey?: string;
};

/**
 * Writes a refund command and returns its id. Run it in the transaction that
 * changes the tickets the refund pays for. With a dedupeKey, a second call
 * returns the first command's id instead of writing another.
 */
export async function queueRefund(tx: Executor, input: RefundCommandInput): Promise<string> {
  const id = randomUUID();
  const params: Stripe.RefundCreateParams = {
    payment_intent: input.paymentIntentId,
    ...(input.amountCents !== null && { amount: input.amountCents }),
    reverse_transfer: input.reverseTransfer,
    refund_application_fee: input.refundApplicationFee,
    metadata: {
      ...input.metadata,
      reason: input.reason,
      ...(input.bookingId && { bookingId: input.bookingId }),
      command_id: id,
    },
  };
  return insertCommand(tx, {
    id,
    operatorId: input.operatorId,
    kind: "refund",
    bookingId: input.bookingId,
    reason: input.reason,
    targetId: input.paymentIntentId,
    amountCents: input.amountCents,
    params,
    dedupeKey: input.dedupeKey ?? null,
  });
}

/** Writes a fee-refund command and returns its id. See queueRefund. */
export async function queueFeeRefund(tx: Executor, input: FeeRefundCommandInput): Promise<string> {
  const id = randomUUID();
  const params: Stripe.ApplicationFeeCreateRefundParams = {
    ...(input.amountCents !== null && { amount: input.amountCents }),
    metadata: {
      ...input.metadata,
      reason: input.reason,
      ...(input.bookingId && { bookingId: input.bookingId }),
      command_id: id,
    },
  };
  return insertCommand(tx, {
    id,
    operatorId: input.operatorId,
    kind: "fee_refund",
    bookingId: input.bookingId,
    reason: input.reason,
    targetId: input.applicationFeeId,
    amountCents: input.amountCents,
    params,
    dedupeKey: input.dedupeKey ?? null,
  });
}

async function insertCommand(
  tx: Executor,
  row: typeof stripeCommands.$inferInsert & { id: string; dedupeKey: string | null },
): Promise<string> {
  if (!row.dedupeKey) {
    await tx.insert(stripeCommands).values(row);
    return row.id;
  }
  const [inserted] = await tx
    .insert(stripeCommands)
    .values(row)
    .onConflictDoNothing({ target: stripeCommands.dedupeKey })
    .returning({ id: stripeCommands.id });
  if (inserted) return inserted.id;
  const [existing] = await tx
    .select({ id: stripeCommands.id })
    .from(stripeCommands)
    .where(eq(stripeCommands.dedupeKey, row.dedupeKey));
  return existing.id;
}

export type SendResult = "sent" | "confirmed" | "pending" | "failed" | "skipped";

/** Stripe refused the request itself; sending it again can't succeed. */
function isPermanent(err: unknown): boolean {
  const type = (err as { type?: string })?.type;
  return (
    type === "StripeInvalidRequestError" ||
    type === "StripeIdempotencyError" ||
    type === "StripeCardError" ||
    type === "StripePermissionError"
  );
}

function errorText(err: unknown): string {
  if (err instanceof Error) {
    const code = (err as { code?: string }).code;
    return `${(err as { type?: string }).type ?? err.name}${code ? ` (${code})` : ""}: ${err.message}`;
  }
  return String(err);
}

/**
 * Finds the Stripe object an earlier attempt of this command created, if its
 * answer was lost. Matches metadata.command_id, which works after Stripe's
 * 24-hour idempotency window has passed.
 */
async function findEarlierAttempt(cmd: { id: string; kind: string; targetId: string }): Promise<string | null> {
  if (cmd.kind === "refund") {
    const refunds = await stripe.refunds.list({ payment_intent: cmd.targetId, limit: 100 });
    return refunds.data.find((r) => r.metadata?.command_id === cmd.id)?.id ?? null;
  }
  const feeRefunds = await stripe.applicationFees.listRefunds(cmd.targetId, { limit: 100 });
  return feeRefunds.data.find((r) => r.metadata?.command_id === cmd.id)?.id ?? null;
}

/**
 * Sends a pending command once, under a claim lease.
 * - sent / confirmed: Stripe accepted it.
 * - pending: a retryable failure; the cron will try again.
 * - failed: Stripe refused it.
 * - skipped: not pending, or another worker holds the claim.
 */
export async function sendCommand(commandId: string, now: Date = new Date()): Promise<SendResult> {
  const leaseCutoff = new Date(now.getTime() - COMMAND_LEASE_MS);
  const [cmd] = await db
    .update(stripeCommands)
    .set({ claimedAt: now, attempts: sql`${stripeCommands.attempts} + 1` })
    .where(
      and(
        eq(stripeCommands.id, commandId),
        eq(stripeCommands.status, "pending"),
        or(isNull(stripeCommands.claimedAt), lt(stripeCommands.claimedAt, leaseCutoff)),
      ),
    )
    .returning();
  if (!cmd) return "skipped";

  const accepted = (objectId: string) =>
    cmd.kind === "fee_refund"
      ? ({ status: "confirmed", stripeObjectId: objectId, sentAt: new Date(), confirmedAt: new Date() } as const)
      : ({ status: "sent", stripeObjectId: objectId, sentAt: new Date() } as const);

  try {
    // A retry may follow an attempt whose answer was lost: look for it first.
    const earlier = cmd.attempts > 1 ? await findEarlierAttempt(cmd) : null;
    let objectId = earlier;
    if (!objectId) {
      const created =
        cmd.kind === "refund"
          ? await stripe.refunds.create(cmd.params as Stripe.RefundCreateParams, { idempotencyKey: cmd.id })
          : await stripe.applicationFees.createRefund(
              cmd.targetId,
              cmd.params as Stripe.ApplicationFeeCreateRefundParams,
              { idempotencyKey: cmd.id },
            );
      objectId = created.id;
    }
    const update = accepted(objectId);
    await db
      .update(stripeCommands)
      .set({ ...update, claimedAt: null, lastError: null })
      .where(eq(stripeCommands.id, cmd.id));
    return update.status;
  } catch (err) {
    const permanent = isPermanent(err);
    await db
      .update(stripeCommands)
      .set({ claimedAt: null, lastError: errorText(err), ...(permanent && { status: "failed" as const }) })
      .where(eq(stripeCommands.id, cmd.id));
    console.error(`Stripe command ${cmd.id} (${cmd.kind} ${cmd.reason}) ${permanent ? "failed" : "will retry"}:`, err);
    return permanent ? "failed" : "pending";
  }
}

/** Sends commands in order; one failure doesn't stop the rest. */
export async function sendCommands(ids: string[], now?: Date): Promise<Record<SendResult, number>> {
  const counts: Record<SendResult, number> = { sent: 0, confirmed: 0, pending: 0, failed: 0, skipped: 0 };
  for (const id of ids) counts[await sendCommand(id, now)]++;
  return counts;
}

/** Sends pending commands, oldest first. Run by the expiry cron. */
export async function sendPendingCommands(opts: { limit?: number; now?: Date } = {}) {
  const now = opts.now ?? new Date();
  const leaseCutoff = new Date(now.getTime() - COMMAND_LEASE_MS);
  const due = await db
    .select({ id: stripeCommands.id })
    .from(stripeCommands)
    .where(
      and(
        eq(stripeCommands.status, "pending"),
        or(isNull(stripeCommands.claimedAt), lt(stripeCommands.claimedAt, leaseCutoff)),
      ),
    )
    .orderBy(asc(stripeCommands.createdAt))
    .limit(opts.limit ?? 50);
  return sendCommands(
    due.map((d) => d.id),
    now,
  );
}

/**
 * Marks the refund commands behind these Stripe refunds confirmed, matched by
 * metadata.command_id. Returns the command ids it confirmed.
 */
export async function confirmRefundCommands(refunds: Stripe.Refund[]): Promise<string[]> {
  const byCommand = new Map<string, string>();
  for (const r of refunds) {
    const commandId = r.metadata?.command_id;
    if (commandId) byCommand.set(commandId, r.id);
  }
  if (byCommand.size === 0) return [];
  const confirmed: string[] = [];
  for (const [commandId, refundId] of byCommand) {
    const rows = await db
      .update(stripeCommands)
      .set({ status: "confirmed", stripeObjectId: refundId, confirmedAt: new Date(), claimedAt: null })
      .where(
        and(
          eq(stripeCommands.id, commandId),
          eq(stripeCommands.kind, "refund"),
          inArray(stripeCommands.status, ["pending", "sent"]),
        ),
      )
      .returning({ id: stripeCommands.id });
    confirmed.push(...rows.map((r) => r.id));
  }
  return confirmed;
}
