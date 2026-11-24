import { auditLog } from "@openboat/db";
import { db } from "@/lib/db";
import { actorOf, type RequestContext } from "@/lib/request-context";

// The audit log (row 12, AR-9): who changed money, seats or settings. Every
// command that makes such a change calls recordAudit in the transaction that
// makes it, so the change and its record commit or roll back together.

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Executor = Tx | typeof db;

type Fields = Record<string, unknown>;

export type AuditEntry = {
  /** The operator the change belongs to; null for a platform-wide change. */
  operatorId: string | null;
  /** noun.verb: ticket.refund, trip.cancel, operator.update, … */
  action: string;
  targetTable: string;
  targetId: string | null;
  before?: Fields | null;
  after?: Fields | null;
  reason?: string | null;
};

/** Fields never written to the log; a change to one shows only as "changed". */
const SECRET_FIELDS = new Set(["passwordHash", "pinHash"]);
const SECRET = "[secret]";

function jsonable(value: unknown): unknown {
  return value instanceof Date ? value.toISOString() : value;
}

function same(a: unknown, b: unknown): boolean {
  return JSON.stringify(jsonable(a)) === JSON.stringify(jsonable(b));
}

/**
 * The fields that differ between two versions of a row, as { before, after }.
 * Fields absent from `after` weren't part of the change and are left out, as
 * is updatedAt. Secrets are recorded only as changed.
 */
export function changedFields(before: Fields | null, after: Fields): { before: Fields | null; after: Fields } {
  const b: Fields = {};
  const a: Fields = {};
  for (const [key, value] of Object.entries(after)) {
    if (key === "updatedAt") continue;
    const old = before?.[key];
    if (before && same(old, value)) continue;
    if (SECRET_FIELDS.has(key)) {
      if (before) b[key] = old == null ? null : SECRET;
      a[key] = value == null ? null : SECRET;
      continue;
    }
    if (before) b[key] = jsonable(old);
    a[key] = jsonable(value);
  }
  return { before: before ? b : null, after: a };
}

/** A row as it is recorded when created: every field, secrets masked. */
export function createdFields(row: Fields): Fields {
  return changedFields(null, row).after;
}

export async function recordAudit(tx: Executor, ctx: RequestContext, entry: AuditEntry): Promise<void> {
  const actor = actorOf(ctx.principal);
  await tx.insert(auditLog).values({
    operatorId: entry.operatorId,
    actorKind: actor.kind,
    actorId: actor.id,
    action: entry.action,
    targetTable: entry.targetTable,
    targetId: entry.targetId,
    before: entry.before ?? null,
    after: entry.after ?? null,
    reason: entry.reason ? entry.reason.slice(0, 500) : null,
    requestId: ctx.requestId,
    createdAt: ctx.now,
  });
}

/** Stripe metadata naming who asked for a refund or transfer, so Stripe and audit_log agree. */
export function actorMetadata(ctx: RequestContext): { actor_kind: string; actor_id: string } {
  const actor = actorOf(ctx.principal);
  return { actor_kind: actor.kind, actor_id: actor.id };
}

/**
 * Records an update from the row before it and the fields it set, if any of
 * them changed. Returns whether it wrote a row.
 */
export async function recordChange(
  tx: Executor,
  ctx: RequestContext,
  entry: Omit<AuditEntry, "before" | "after"> & { before: Fields; set: Fields },
): Promise<boolean> {
  const { before, set, ...rest } = entry;
  const diff = changedFields(before, set);
  if (Object.keys(diff.after).length === 0) return false;
  await recordAudit(tx, ctx, { ...rest, ...diff });
  return true;
}
