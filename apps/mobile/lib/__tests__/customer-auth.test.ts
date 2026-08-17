import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("expo-secure-store", () => ({
  setItemAsync: vi.fn().mockResolvedValue(undefined),
  getItemAsync: vi.fn(),
  deleteItemAsync: vi.fn().mockResolvedValue(undefined),
}));

import * as SecureStore from "expo-secure-store";
import {
  decodeCustomerToken,
  saveCustomerToken,
  getCustomerToken,
  clearCustomerToken,
} from "../customer-auth";

const FUTURE = Math.floor(Date.now() / 1000) + 3600;
const PAST = Math.floor(Date.now() / 1000) - 3600;

function makeToken(payload: object): string {
  const b64 = Buffer.from(JSON.stringify(payload))
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=/g, "");
  return `${b64}.fakesig`;
}

describe("decodeCustomerToken", () => {
  it("returns a valid profile for a non-expired token", () => {
    const payload = {
      customerId: "cust-1",
      operatorId: "op-1",
      email: "alice@example.com",
      name: "Alice",
      exp: FUTURE,
    };
    expect(decodeCustomerToken(makeToken(payload))).toEqual(payload);
  });

  it("returns null for an expired token", () => {
    const payload = {
      customerId: "cust-2",
      operatorId: "op-1",
      email: "bob@example.com",
      name: null,
      exp: PAST,
    };
    expect(decodeCustomerToken(makeToken(payload))).toBeNull();
  });

  it("returns null for a token with invalid base64", () => {
    expect(decodeCustomerToken("!!!.sig")).toBeNull();
  });

  it("returns null for an empty string", () => {
    expect(decodeCustomerToken("")).toBeNull();
  });

  it("returns null when the payload is not valid JSON", () => {
    const b64 = Buffer.from("not-json").toString("base64url");
    expect(decodeCustomerToken(`${b64}.sig`)).toBeNull();
  });

  it("handles a null name field", () => {
    const payload = { customerId: "c", operatorId: "o", email: "e@e.com", name: null, exp: FUTURE };
    expect(decodeCustomerToken(makeToken(payload))?.name).toBeNull();
  });
});

describe("saveCustomerToken", () => {
  beforeEach(() => vi.clearAllMocks());

  it("delegates to SecureStore.setItemAsync", async () => {
    await saveCustomerToken("tok-abc");
    expect(SecureStore.setItemAsync).toHaveBeenCalledWith("customer_token", "tok-abc");
  });
});

describe("getCustomerToken", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns the stored token string", async () => {
    vi.mocked(SecureStore.getItemAsync).mockResolvedValueOnce("tok-abc");
    expect(await getCustomerToken()).toBe("tok-abc");
  });

  it("returns null when nothing is stored", async () => {
    vi.mocked(SecureStore.getItemAsync).mockResolvedValueOnce(null);
    expect(await getCustomerToken()).toBeNull();
  });
});

describe("clearCustomerToken", () => {
  beforeEach(() => vi.clearAllMocks());

  it("delegates to SecureStore.deleteItemAsync", async () => {
    await clearCustomerToken();
    expect(SecureStore.deleteItemAsync).toHaveBeenCalledWith("customer_token");
  });
});
