import { and, asc, eq, isNull, lt, or, sql } from "drizzle-orm";
import type Stripe from "stripe";
import { db } from "@/lib/db";
import { stripeEvents } from "@openboat/db";

// The Stripe event inbox (row 10, AR-6). Every webhook event is saved before
// it is acted on, then processed once:
//
// - A handler returns an outcome: handled, ignored (not this deployment's
//   payment, or nothing to do) or needs_review (ours, but the app can't act on
//   it safely). Any of the three finishes the event.
// - A handler that throws leaves the event unfinished with last_error. The
//   webhook then answers 500, so Stripe redelivers it, and the expiry cron
//   drains whatever is still unfinished. An event still failing three days
//   after Stripe created it is given up as needs_review.
//
// Processing claims the row with a lease rather than a row lock, because the
// handlers open their own transactions.

export type EventOutcome = "handled" | "ignored" | "needs_review";

export type EventResult = {
  outcome: EventOutcome;
  /** The operator the event belongs to, when the handler resolved one. */
  operatorId?: string | null;
  /** Why the event was ignored or needs review; kept as last_error. */
  note?: string;
};

export type EventDispatcher = (event: Stripe.Event) => Promise<EventResult>;

/**
 * Thrown by a handler when the event is ours but arrived before the state it
 * depends on (a refund or dispute before payment_intent.succeeded). The event
 * is retried, which is how out-of-order delivery resolves (P3-8).
 */
export class OutOfOrderEventError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OutOfOrderEventError";
  }
}

/** How long a claim lasts before another worker may take the event over. */
export const CLAIM_LEASE_MS = 5 * 60 * 1000;
/** Stripe stops redelivering after about three days; so does the inbox. */
export const GIVE_UP_AFTER_MS = 3 * 24 * 60 * 60 * 1000;

/** Saves an event. A redelivery of a saved event changes nothing. */
export async function recordEvent(event: Stripe.Event): Promise<void> {
  await db
    .insert(stripeEvents)
    .values({
      id: event.id,
      type: event.type,
      account: event.account ?? null,
      livemode: event.livemode,
      stripeCreatedAt: new Date(event.created * 1000),
      payload: event,
    })
    .onConflictDoNothing({ target: stripeEvents.id });
}

export type ProcessResult = "processed" | "retry" | "skipped";

/**
 * Processes a saved event once.
 * - processed: finished (handled, ignored or needs_review).
 * - retry: the handler failed; the event stays unfinished for a redelivery or the drain.
 * - skipped: already finished, or another worker holds an unexpired claim.
 */
export async function processEvent(
  eventId: string,
  dispatch: EventDispatcher,
  now: Date = new Date(),
): Promise<ProcessResult> {
  const leaseCutoff = new Date(now.getTime() - CLAIM_LEASE_MS);
  const [claimed] = await db
    .update(stripeEvents)
    .set({ claimedAt: now, attempts: sql`${stripeEvents.attempts} + 1` })
    .where(
      and(
        eq(stripeEvents.id, eventId),
        isNull(stripeEvents.processedAt),
        or(isNull(stripeEvents.claimedAt), lt(stripeEvents.claimedAt, leaseCutoff)),
      ),
    )
    .returning({ payload: stripeEvents.payload, stripeCreatedAt: stripeEvents.stripeCreatedAt });

  if (!claimed) return "skipped";

  try {
    const result = await dispatch(claimed.payload as Stripe.Event);
    await db
      .update(stripeEvents)
      .set({
        processedAt: new Date(),
        claimedAt: null,
        outcome: result.outcome,
        operatorId: result.operatorId ?? null,
        lastError: result.note ?? null,
      })
      .where(eq(stripeEvents.id, eventId));
    if (result.outcome === "needs_review") {
      console.error(`Stripe event ${eventId} needs review: ${result.note ?? "(no detail)"}`);
    }
    return "processed";
  } catch (err) {
    const message = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
    const givingUp = now.getTime() - claimed.stripeCreatedAt.getTime() > GIVE_UP_AFTER_MS;
    await db
      .update(stripeEvents)
      .set(
        givingUp
          ? {
              processedAt: new Date(),
              claimedAt: null,
              outcome: "needs_review" as const,
              lastError: `Gave up after three days of retries. Last error: ${message}`,
            }
          : { claimedAt: null, lastError: message },
      )
      .where(eq(stripeEvents.id, eventId));
    console.error(`Stripe event ${eventId} failed${givingUp ? " for good" : ", will retry"}: ${message}`);
    return givingUp ? "processed" : "retry";
  }
}

/**
 * Processes unfinished events, oldest first. Run by the expiry cron as the
 * backstop for Stripe's redeliveries.
 */
export async function drainEvents(
  dispatch: EventDispatcher,
  opts: { limit?: number; now?: Date } = {},
): Promise<{ processed: number; retry: number }> {
  const now = opts.now ?? new Date();
  const leaseCutoff = new Date(now.getTime() - CLAIM_LEASE_MS);
  const due = await db
    .select({ id: stripeEvents.id })
    .from(stripeEvents)
    .where(
      and(
        isNull(stripeEvents.processedAt),
        or(isNull(stripeEvents.claimedAt), lt(stripeEvents.claimedAt, leaseCutoff)),
      ),
    )
    .orderBy(asc(stripeEvents.stripeCreatedAt))
    .limit(opts.limit ?? 50);

  let processed = 0;
  let retry = 0;
  for (const { id } of due) {
    const result = await processEvent(id, dispatch, now);
    if (result === "processed") processed++;
    if (result === "retry") retry++;
  }
  return { processed, retry };
}
