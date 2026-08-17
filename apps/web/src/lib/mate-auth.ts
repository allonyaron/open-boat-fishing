import { createHmac, timingSafeEqual } from "crypto";
import { NextRequest, NextResponse } from "next/server";

type MateTokenPayload = {
  staffId: string;
  operatorId: string;
  role: string;
  name: string;
};

export type { MateTokenPayload };

function b64url(buf: Buffer): string {
  return buf.toString("base64url");
}

export function signMateToken(payload: MateTokenPayload): string {
  const secret = process.env.SESSION_SECRET!;
  const exp = Math.floor(Date.now() / 1000) + 60 * 60 * 24; // 24h
  const data = b64url(Buffer.from(JSON.stringify({ ...payload, aud: "mate", exp })));
  const sig = b64url(createHmac("sha256", secret).update(data).digest());
  return `${data}.${sig}`;
}

function verifyMateToken(token: string): MateTokenPayload | null {
  const secret = process.env.SESSION_SECRET!;
  const dot = token.lastIndexOf(".");
  if (dot < 0) return null;
  const data = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expected = b64url(createHmac("sha256", secret).update(data).digest());
  const sigBuf = Buffer.from(sig);
  const expectedBuf = Buffer.from(expected);
  if (sigBuf.length !== expectedBuf.length || !timingSafeEqual(sigBuf, expectedBuf)) {
    return null;
  }
  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(Buffer.from(data, "base64url").toString());
  } catch {
    return null;
  }
  if (typeof payload.exp !== "number" || payload.exp < Date.now() / 1000) return null;
  if (payload.aud !== "mate") return null;
  return payload as unknown as MateTokenPayload;
}

export async function requireMate(
  req: NextRequest,
): Promise<{ staff: MateTokenPayload } | NextResponse> {
  const auth = req.headers.get("authorization");
  if (!auth?.startsWith("Bearer ")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const payload = verifyMateToken(auth.slice(7));
  if (!payload) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (payload.role !== "mate" && payload.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  return { staff: payload };
}
