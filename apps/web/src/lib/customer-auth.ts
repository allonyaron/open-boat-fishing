import { createHmac, timingSafeEqual } from "crypto";
import { NextRequest, NextResponse } from "next/server";

type CustomerTokenPayload = {
  customerId: string;
  operatorId: string;
  email: string;
  name: string | null;
};

export type { CustomerTokenPayload };

function b64url(buf: Buffer): string {
  return buf.toString("base64url");
}

export function signCustomerToken(payload: CustomerTokenPayload): string {
  const secret = process.env.SESSION_SECRET!;
  const exp = Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 90; // 90 days
  const data = b64url(Buffer.from(JSON.stringify({ ...payload, aud: "customer", exp })));
  const sig = b64url(createHmac("sha256", secret).update(data).digest());
  return `${data}.${sig}`;
}

function verifyCustomerToken(token: string): CustomerTokenPayload | null {
  const secret = process.env.SESSION_SECRET!;
  const dot = token.lastIndexOf(".");
  if (dot < 0) return null;
  const data = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expected = b64url(createHmac("sha256", secret).update(data).digest());
  const sigBuf = Buffer.from(sig);
  const expectedBuf = Buffer.from(expected);
  if (sigBuf.length !== expectedBuf.length || !timingSafeEqual(sigBuf, expectedBuf)) return null;
  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(Buffer.from(data, "base64url").toString());
  } catch {
    return null;
  }
  if (typeof payload.exp !== "number" || payload.exp < Date.now() / 1000) return null;
  if (payload.aud !== "customer") return null;
  return payload as unknown as CustomerTokenPayload;
}

export async function requireCustomer(
  req: NextRequest,
): Promise<{ customer: CustomerTokenPayload } | NextResponse> {
  const auth = req.headers.get("authorization");
  if (!auth?.startsWith("Bearer ")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const payload = verifyCustomerToken(auth.slice(7));
  if (!payload) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  // Token operatorId must match the middleware-resolved x-operator-id header.
  // Prevents a token issued for operator A from being used against operator B
  // in centralized (multi-tenant) mode.
  const operatorIdHeader = req.headers.get("x-operator-id");
  if (operatorIdHeader && payload.operatorId !== operatorIdHeader) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return { customer: payload };
}
