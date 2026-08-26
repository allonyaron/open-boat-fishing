import type { NextRequest } from "next/server";
import { headers } from "next/headers";

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
