import { describe, it, expect, vi, afterEach } from "vitest";
import { NextRequest } from "next/server";
import { randomUUID } from "crypto";
import { signHoldToken, verifyHoldToken, requireHoldToken, HOLD_TOKEN_TTL_MS } from "@/lib/bookings/hold-token";
import { signCustomerToken } from "@/lib/customer-auth";

const bookingId = randomUUID();
const operatorId = randomUUID();

afterEach(() => {
  vi.useRealTimers();
});

describe("hold tokens", () => {
  it("verifies for the booking and operator it was issued for", () => {
    const token = signHoldToken({ bookingId, operatorId });
    expect(verifyHoldToken(token, bookingId, operatorId)).toBe(true);
  });

  it("rejects another booking's id", () => {
    const token = signHoldToken({ bookingId, operatorId });
    expect(verifyHoldToken(token, randomUUID(), operatorId)).toBe(false);
  });

  it("rejects another operator", () => {
    const token = signHoldToken({ bookingId, operatorId });
    expect(verifyHoldToken(token, bookingId, randomUUID())).toBe(false);
  });

  it("rejects a token whose payload was edited", () => {
    const token = signHoldToken({ bookingId, operatorId });
    const [, sig] = token.split(".");
    const forged = Buffer.from(
      JSON.stringify({ bookingId: randomUUID(), operatorId, aud: "hold", exp: 9_999_999_999 }),
    ).toString("base64url");
    expect(verifyHoldToken(`${forged}.${sig}`, bookingId, operatorId)).toBe(false);
  });

  it("rejects a customer token, which has a different audience", () => {
    const token = signCustomerToken({ customerId: bookingId, operatorId, email: "a@b.com", name: null });
    expect(verifyHoldToken(token, bookingId, operatorId)).toBe(false);
  });

  it("expires 90 minutes after the booking was created", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const createdAt = new Date("2026-10-09T12:00:00Z");
    vi.setSystemTime(createdAt);
    const token = signHoldToken({ bookingId, operatorId }, createdAt);

    vi.setSystemTime(createdAt.getTime() + HOLD_TOKEN_TTL_MS - 1000);
    expect(verifyHoldToken(token, bookingId, operatorId)).toBe(true);

    vi.setSystemTime(createdAt.getTime() + HOLD_TOKEN_TTL_MS + 1000);
    expect(verifyHoldToken(token, bookingId, operatorId)).toBe(false);
  });

  it("rejects garbage", () => {
    expect(verifyHoldToken("", bookingId, operatorId)).toBe(false);
    expect(verifyHoldToken("no-dot", bookingId, operatorId)).toBe(false);
    expect(verifyHoldToken("a.b", bookingId, operatorId)).toBe(false);
  });

  describe("requireHoldToken", () => {
    function req(token?: string) {
      return new NextRequest("http://localhost/api/bookings/x/release", {
        method: "POST",
        headers: token ? { "X-Hold-Token": token } : {},
      });
    }

    it("returns 401 when the header is missing", () => {
      expect(requireHoldToken(req(), bookingId, operatorId)?.status).toBe(401);
    });

    it("returns null for a valid token", () => {
      expect(requireHoldToken(req(signHoldToken({ bookingId, operatorId })), bookingId, operatorId)).toBeNull();
    });
  });
});
