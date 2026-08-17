import { describe, it, expect } from "vitest";
import { NextRequest } from "next/server";
import { signMateToken, requireMate } from "@/lib/mate-auth";

const validPayload = {
  staffId: "staff-123",
  operatorId: "op-456",
  role: "mate" as const,
  name: "Test Mate",
};

function req(token?: string) {
  return new NextRequest("http://localhost/api/test", {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
}

describe("signMateToken / requireMate", () => {
  it("round-trips: sign then verify returns the payload", async () => {
    const token = signMateToken(validPayload);
    const result = await requireMate(req(token));
    expect("staff" in result).toBe(true);
    if ("staff" in result) {
      expect(result.staff.staffId).toBe(validPayload.staffId);
      expect(result.staff.operatorId).toBe(validPayload.operatorId);
      expect(result.staff.role).toBe("mate");
      expect(result.staff.name).toBe(validPayload.name);
    }
  });

  it("accepts admin role", async () => {
    const token = signMateToken({ ...validPayload, role: "admin" });
    const result = await requireMate(req(token));
    expect("staff" in result).toBe(true);
  });

  it("returns 401 with no Authorization header", async () => {
    const result = await requireMate(req());
    expect("status" in result).toBe(true);
    if ("status" in result) expect(result.status).toBe(401);
  });

  it("returns 401 with a tampered signature", async () => {
    const token = signMateToken(validPayload);
    const tampered = token.slice(0, -4) + "XXXX";
    const result = await requireMate(req(tampered));
    expect("status" in result).toBe(true);
    if ("status" in result) expect(result.status).toBe(401);
  });

  it("returns 401 with a completely invalid token", async () => {
    const result = await requireMate(req("not-a-real-token"));
    expect("status" in result).toBe(true);
    if ("status" in result) expect(result.status).toBe(401);
  });

  it("returns 401 with an expired token", async () => {
    // Build a token whose exp is 1 second in the past
    const { createHmac } = await import("crypto");
    const secret = process.env.SESSION_SECRET!;
    const payload = { ...validPayload, exp: Math.floor(Date.now() / 1000) - 1 };
    const data = Buffer.from(JSON.stringify(payload)).toString("base64url");
    const sig = createHmac("sha256", secret).update(data).digest().toString("base64url");
    const expired = `${data}.${sig}`;
    const result = await requireMate(req(expired));
    expect("status" in result).toBe(true);
    if ("status" in result) expect(result.status).toBe(401);
  });

  it("returns 403 for a non-mate non-admin role", async () => {
    const token = signMateToken({ ...validPayload, role: "captain" });
    const result = await requireMate(req(token));
    expect("status" in result).toBe(true);
    if ("status" in result) expect(result.status).toBe(403);
  });
});
