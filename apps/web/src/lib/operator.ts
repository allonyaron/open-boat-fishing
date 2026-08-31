import type { NextRequest } from "next/server";
import { headers } from "next/headers";
import { db } from "@/lib/db";
import { operators } from "@openboat/db";
import { eq } from "drizzle-orm";

/**
 * For API route handlers — reads x-operator-id from the incoming NextRequest.
 * Returns null if missing (middleware returns 404 first in production, but
 * callers should guard regardless).
 */
export function getOperatorId(req: NextRequest): string | null {
  return req.headers.get("x-operator-id");
}

/**
 * For Server Components and async page functions — reads x-operator-id from
 * the request headers forwarded by middleware via next/headers.
 */
export async function getOperatorIdFromHeaders(): Promise<string | null> {
  return (await headers()).get("x-operator-id");
}

export type OperatorContext = Pick<
  typeof operators.$inferSelect,
  | "id"
  | "name"
  | "slug"
  | "emailFrom"
  | "emailDomain"
  | "stripeAccountId"
  | "stripeOnboardingComplete"
  | "termsUrl"
  | "feeBearer"
  | "feeDisplay"
  | "cancelWindowHrs"
  | "settleGraceHrs"
  | "phone"
  | "dockAddress"
  | "dockMapsUrl"
>;

const operatorContextFields = {
  id: operators.id,
  name: operators.name,
  slug: operators.slug,
  emailFrom: operators.emailFrom,
  emailDomain: operators.emailDomain,
  stripeAccountId: operators.stripeAccountId,
  stripeOnboardingComplete: operators.stripeOnboardingComplete,
  termsUrl: operators.termsUrl,
  feeBearer: operators.feeBearer,
  feeDisplay: operators.feeDisplay,
  cancelWindowHrs: operators.cancelWindowHrs,
  settleGraceHrs: operators.settleGraceHrs,
  phone: operators.phone,
  dockAddress: operators.dockAddress,
  dockMapsUrl: operators.dockMapsUrl,
} as const;

/**
 * Resolves the operator from the x-operator-id header and fetches the standard
 * field set in one call. Returns null if the header is missing or the operator
 * row is not found — callers should return a 500 in that case.
 */
export async function getOperatorContext(req: NextRequest): Promise<OperatorContext | null> {
  const operatorId = getOperatorId(req);
  if (!operatorId) return null;

  const [operator] = await db
    .select(operatorContextFields)
    .from(operators)
    .where(eq(operators.id, operatorId));

  return operator ?? null;
}

/**
 * Server-component variant of getOperatorContext — reads x-operator-id from
 * next/headers instead of a NextRequest. Returns null if the header is missing
 * or the operator row is not found.
 */
export async function getOperatorRecord(): Promise<OperatorContext | null> {
  const operatorId = await getOperatorIdFromHeaders();
  if (!operatorId) return null;

  const [operator] = await db
    .select(operatorContextFields)
    .from(operators)
    .where(eq(operators.id, operatorId));

  return operator ?? null;
}
