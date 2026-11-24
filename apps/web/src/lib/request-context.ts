import { randomUUID } from "crypto";
import type { NextRequest } from "next/server";

// Who is acting, and on which request (row 12, AR-9). Every command that
// changes money, seats or settings takes a context and records its principal
// in audit_log. Row 26 (AR-2) adds the tenant and builds every context here.

export type Principal =
  /** An operator's admin (web console) or mate (boat app). */
  | { kind: "staff"; staffId: string; operatorId: string; role: "admin" | "mate" }
  /** A platform console user. */
  | { kind: "platform"; platformUserId: string }
  /** A customer signed in by email code. */
  | { kind: "customer"; customerId: string; operatorId: string }
  /** A scheduled job, by name. */
  | { kind: "system"; job: string }
  /** A Stripe event, by its evt_… id. */
  | { kind: "stripe"; eventId: string };

export type RequestContext = {
  principal: Principal;
  /** Vercel's request id when there is one, to find the request in the logs. */
  requestId: string | null;
  now: Date;
};

/** The actor columns of audit_log, and the actor in Stripe metadata. */
export function actorOf(principal: Principal): { kind: Principal["kind"]; id: string } {
  switch (principal.kind) {
    case "staff":
      return { kind: "staff", id: principal.staffId };
    case "platform":
      return { kind: "platform", id: principal.platformUserId };
    case "customer":
      return { kind: "customer", id: principal.customerId };
    case "system":
      return { kind: "system", id: principal.job };
    case "stripe":
      return { kind: "stripe", id: principal.eventId };
  }
}

export function requestIdOf(req: NextRequest): string {
  return req.headers.get("x-vercel-id") ?? randomUUID();
}

export function requestContext(req: NextRequest, principal: Principal, now: Date = new Date()): RequestContext {
  return { principal, requestId: requestIdOf(req), now };
}

/** For a scheduled job: the cron that runs it is the actor. */
export function systemContext(job: string, now: Date = new Date()): RequestContext {
  return { principal: { kind: "system", job }, requestId: null, now };
}

/** For a Stripe event handler: the event is the actor. */
export function stripeContext(eventId: string, now: Date = new Date()): RequestContext {
  return { principal: { kind: "stripe", eventId }, requestId: null, now };
}
