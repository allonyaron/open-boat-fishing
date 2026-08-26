import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { neon } from "@neondatabase/serverless";

function withOperatorId(request: NextRequest, operatorId: string) {
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-operator-id", operatorId);
  return NextResponse.next({ request: { headers: requestHeaders } });
}

export async function middleware(request: NextRequest) {
  if (request.nextUrl.pathname === "/admin") {
    return NextResponse.redirect(new URL("/admin/trips", request.url));
  }

  // Already resolved (e.g. internal re-routes or test harness)
  if (request.headers.get("x-operator-id")) {
    return NextResponse.next();
  }

  // Single-deploy mode: OPERATOR_ID env var skips the DB lookup entirely.
  // Set this on per-operator deployments so existing deployments need no code changes.
  const envOperatorId = process.env.OPERATOR_ID;
  if (envOperatorId) {
    return withOperatorId(request, envOperatorId);
  }

  // Centralized mode: resolve hostname → operator_id via the `domains` table.
  const hostname = request.headers.get("host")?.split(":")[0] ?? "";

  const sql = neon(process.env.DATABASE_URL!);
  const rows = await sql`
    SELECT operator_id FROM domains WHERE domain = ${hostname} LIMIT 1
  `;

  if (!rows[0]) {
    return new NextResponse("No operator configured for this domain", { status: 404 });
  }

  return withOperatorId(request, rows[0].operator_id as string);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
