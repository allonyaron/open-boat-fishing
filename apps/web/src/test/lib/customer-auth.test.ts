import { describe, it, expect } from "vitest";
import { NextRequest } from "next/server";
import { signCustomerToken, requireCustomer } from "@/lib/customer-auth";

const validPayload = {
  customerId: "cust-123",
  operatorId: "op-456",
  email: "test@example.com",
  name: "Test Customer",
};

function req(token?: string) {
  return new NextRequest("http://localhost/api/test", {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
}

describe("signCustomerToken / requireCustomer", () => {
  it("round-trips: sign then verify returns the payload", async () => {
    const token = signCustomerToken(validPayload);
    const result = await requireCustomer(req(token));
    expect("customer" in result).toBe(true);
    if ("customer" in result) {
      expect(result.customer.customerId).toBe(validPayload.customerId);
      expect(result.customer.operatorId).toBe(validPayload.operatorId);
      expect(result.customer.email).toBe(validPayload.email);
      expect(result.customer.name).toBe(validPayload.name);
    }
  });

  it("accepts null name", async () => {
    const token = signCustomerToken({ ...validPayload, name: null });
    const result = await requireCustomer(req(token));
    expect("customer" in result).toBe(true);
    if ("customer" in result) expect(result.customer.name).toBeNull();
  });

  it("returns 401 with no Authorization header", async () => {
    const result = await requireCustomer(req());
    expect("status" in result).toBe(true);
    if ("status" in result) expect(result.status).toBe(401);
  });

  it("returns 401 with a tampered signature", async () => {
    const token = signCustomerToken(validPayload);
    const tampered = token.slice(0, -4) + "XXXX";
    const result = await requireCustomer(req(tampered));
    expect("status" in result).toBe(true);
    if ("status" in result) expect(result.status).toBe(401);
  });

  it("returns 401 with a completely invalid token", async () => {
    const result = await requireCustomer(req("garbage"));
    expect("status" in result).toBe(true);
    if ("status" in result) expect(result.status).toBe(401);
  });

  it("returns 401 with an expired token", async () => {
    const { createHmac } = await import("crypto");
    const secret = process.env.SESSION_SECRET!;
    const payload = { ...validPayload, exp: Math.floor(Date.now() / 1000) - 1 };
    const data = Buffer.from(JSON.stringify(payload)).toString("base64url");
    const sig = createHmac("sha256", secret).update(data).digest().toString("base64url");
    const expired = `${data}.${sig}`;
    const result = await requireCustomer(req(expired));
    expect("status" in result).toBe(true);
    if ("status" in result) expect(result.status).toBe(401);
  });

  it("returns 401 for token with no dot separator", async () => {
    const result = await requireCustomer(req("nodothere"));
    expect("status" in result).toBe(true);
    if ("status" in result) expect(result.status).toBe(401);
  });

  it("rejects a mate token (audience mismatch)", async () => {
    const { signMateToken } = await import("@/lib/mate-auth");
    const mateToken = signMateToken({
      staffId: "staff-123",
      operatorId: "op-456",
      role: "mate",
      name: "Test Mate",
    });
    const result = await requireCustomer(req(mateToken));
    expect("status" in result).toBe(true);
    if ("status" in result) expect(result.status).toBe(401);
  });
});
