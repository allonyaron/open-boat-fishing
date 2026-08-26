import type { NextRequest } from "next/server";

/**
 * Resolves the operator ID for the current request.
 *
 * In single-deploy mode the middleware sets x-operator-id from the OPERATOR_ID
 * env var. In centralized mode the middleware resolves it from the `domains`
 * table. Either way, API routes just call this — they don't care which mode
 * they're in.
 *
 * Returns null if the header is missing (shouldn't happen in production since
 * the middleware returns 404 first, but callers should handle it).
 */
export function getOperatorId(req: NextRequest): string | null {
  return req.headers.get("x-operator-id");
}
