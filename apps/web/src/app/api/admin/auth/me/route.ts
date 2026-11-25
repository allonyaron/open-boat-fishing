import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/session";

// The console asks this on every page load; it goes through the same check as
// every admin route, so a deactivated admin is sent to sign in.
export async function GET(req: NextRequest) {
  const auth = await requireAdmin(req);
  if (auth instanceof NextResponse) return auth;
  const { session } = auth;
  return NextResponse.json({
    staffId: session.staffId,
    name: session.name,
    role: session.role,
  });
}
