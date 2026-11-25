import { and, desc, eq, isNull, lt, or } from "drizzle-orm";
import { db } from "@/lib/db";
import { bookings, stripeCommands, stripeEvents } from "@openboat/db";
import { sendCommand, type SendResult } from "./commands";
import { recordAudit } from "@/lib/audit";
import type { RequestContext } from "@/lib/request-context";

// What the Money page's "Needs attention" list shows (row 10, closes P3-9's
// log-only "manual review"): refunds Stripe refused, refunds still waiting to
// reach Stripe, and payment events the app couldn't act on by itself.

/** A queued refund older than this that still hasn't reached Stripe is shown. */
export const STUCK_AFTER_MS = 15 * 60 * 1000;

export type AttentionItem = {
  kind: "command" | "event";
  id: string;
  /** One line saying what happened. */
  what: string;
  /** Stripe's error, or the handler's note. */
  detail: string | null;
  at: string;
  amountCents: number | null;
  confirmationCode: string | null;
  /** Only a refund can be sent again. */
  canRetry: boolean;
  /**
   * A refund Stripe refused, or an event, can be marked dealt with. A refund
   * still waiting can't: the cron would send it anyway.
   */
  canResolve: boolean;
};

const EVENT_HEADLINES: Record<string, string> = {
  "charge.dispute.created": "A customer opened a chargeback",
  "charge.dispute.funds_withdrawn": "A bank inquiry became a chargeback",
  "charge.dispute.closed": "A chargeback closed and needs checking",
  "charge.refunded": "A refund was made outside the app",
  "payment_intent.succeeded": "A payment needs checking",
};

const COMMAND_HEADLINES: Record<
  (typeof stripeCommands.$inferSelect)["kind"],
  { failed: string; stuck: string }
> = {
  refund: { failed: "Stripe refused a refund", stuck: "A refund hasn't reached Stripe yet" },
  fee_refund: {
    failed: "Stripe refused a platform-fee refund",
    stuck: "A platform-fee refund hasn't reached Stripe yet",
  },
  transfer_reversal: {
    failed: "Stripe refused to take a chargeback back from the boat's balance",
    stuck: "Taking a chargeback back from the boat's balance hasn't reached Stripe yet",
  },
  transfer: {
    failed: "Stripe refused to return a won chargeback to the boat",
    stuck: "Returning a won chargeback to the boat hasn't reached Stripe yet",
  },
};

/** Drops Stripe's error class and code from the front of a stored error. */
function plainStripeError(text: string): string {
  return text.replace(/^Stripe\w*Error(?:\s*\([^)]*\))?:\s*/, "");
}

export async function listAttention(operatorId: string, now: Date = new Date()): Promise<AttentionItem[]> {
  const stuckBefore = new Date(now.getTime() - STUCK_AFTER_MS);

  const commands = await db
    .select({
      id: stripeCommands.id,
      kind: stripeCommands.kind,
      status: stripeCommands.status,
      amountCents: stripeCommands.amountCents,
      lastError: stripeCommands.lastError,
      createdAt: stripeCommands.createdAt,
      confirmationCode: bookings.confirmationCode,
    })
    .from(stripeCommands)
    .leftJoin(bookings, eq(bookings.id, stripeCommands.bookingId))
    .where(
      and(
        eq(stripeCommands.operatorId, operatorId),
        isNull(stripeCommands.resolvedAt),
        or(
          eq(stripeCommands.status, "failed"),
          and(eq(stripeCommands.status, "pending"), lt(stripeCommands.createdAt, stuckBefore)),
        ),
      ),
    )
    .orderBy(desc(stripeCommands.createdAt))
    .limit(100);

  const events = await db
    .select({
      id: stripeEvents.id,
      type: stripeEvents.type,
      note: stripeEvents.lastError,
      at: stripeEvents.stripeCreatedAt,
    })
    .from(stripeEvents)
    .where(
      and(
        eq(stripeEvents.operatorId, operatorId),
        eq(stripeEvents.outcome, "needs_review"),
        isNull(stripeEvents.resolvedAt),
      ),
    )
    .orderBy(desc(stripeEvents.stripeCreatedAt))
    .limit(100);

  const items: AttentionItem[] = [
    ...commands.map((c): AttentionItem => {
      const what = COMMAND_HEADLINES[c.kind][c.status === "failed" ? "failed" : "stuck"];
      return {
        kind: "command",
        id: c.id,
        what,
        detail: c.lastError ? plainStripeError(c.lastError) : null,
        at: c.createdAt.toISOString(),
        amountCents: c.amountCents,
        confirmationCode: c.confirmationCode,
        canRetry: true,
        canResolve: c.status === "failed",
      };
    }),
    ...events.map(
      (e): AttentionItem => ({
        kind: "event",
        id: e.id,
        what: EVENT_HEADLINES[e.type] ?? "A Stripe event needs checking",
        detail: e.note,
        at: e.at.toISOString(),
        amountCents: null,
        confirmationCode: null,
        canRetry: false,
        canResolve: true,
      }),
    ),
  ];
  return items.sort((a, b) => b.at.localeCompare(a.at));
}

export type RetryResult = SendResult | "not_found";

/**
 * Sends a failed or stuck refund again, recording who asked. A failed one
 * goes back to pending first.
 */
export async function retryCommand(ctx: RequestContext, operatorId: string, commandId: string): Promise<RetryResult> {
  const found = await db.transaction(async (tx) => {
    const [cmd] = await tx
      .select({ id: stripeCommands.id, status: stripeCommands.status })
      .from(stripeCommands)
      .where(and(eq(stripeCommands.id, commandId), eq(stripeCommands.operatorId, operatorId)))
      .for("update");
    if (!cmd) return false;
    if (cmd.status === "failed") {
      await tx
        .update(stripeCommands)
        .set({ status: "pending", claimedAt: null })
        .where(and(eq(stripeCommands.id, commandId), eq(stripeCommands.status, "failed")));
    }
    await recordAudit(tx, ctx, {
      operatorId,
      action: "stripe_command.retry",
      targetTable: "stripe_commands",
      targetId: commandId,
      before: { status: cmd.status },
      after: { status: cmd.status === "failed" ? "pending" : cmd.status },
    });
    return true;
  });
  if (!found) return "not_found";
  return sendCommand(commandId);
}

/** Marks an item dealt with, by this staff member. Returns false if it isn't this operator's. */
export async function resolveAttention(
  ctx: RequestContext,
  operatorId: string,
  kind: "command" | "event",
  id: string,
): Promise<boolean> {
  const now = ctx.now;
  const resolvedBy = ctx.principal.kind === "staff" ? ctx.principal.staffId : null;
  return db.transaction(async (tx) => {
    const rows =
      kind === "command"
        ? await tx
            .update(stripeCommands)
            .set({ resolvedAt: now, resolvedBy })
            .where(
              and(
                eq(stripeCommands.id, id),
                eq(stripeCommands.operatorId, operatorId),
                eq(stripeCommands.status, "failed"),
              ),
            )
            .returning({ id: stripeCommands.id })
        : await tx
            .update(stripeEvents)
            .set({ resolvedAt: now, resolvedBy })
            .where(and(eq(stripeEvents.id, id), eq(stripeEvents.operatorId, operatorId)))
            .returning({ id: stripeEvents.id });
    if (rows.length === 0) return false;
    await recordAudit(tx, ctx, {
      operatorId,
      action: kind === "command" ? "stripe_command.resolve" : "stripe_event.resolve",
      targetTable: kind === "command" ? "stripe_commands" : "stripe_events",
      targetId: id,
      after: { resolvedAt: now.toISOString() },
    });
    return true;
  });
}
