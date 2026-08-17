import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("expo-secure-store", () => ({
  setItemAsync: vi.fn().mockResolvedValue(undefined),
  getItemAsync: vi.fn(),
  deleteItemAsync: vi.fn().mockResolvedValue(undefined),
}));

import * as SecureStore from "expo-secure-store";
import {
  decodeMateToken,
  saveMateToken,
  getMateToken,
  clearMateToken,
} from "../mate-auth";

const FUTURE = Math.floor(Date.now() / 1000) + 3600;
const PAST = Math.floor(Date.now() / 1000) - 3600;

// Builds a token in the same format the server produces:
// base64url(payload).signature
function makeMateToken(payload: object): string {
  const b64 = Buffer.from(JSON.stringify(payload))
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=/g, "");
  return `${b64}.fakesig`;
}

const STAFF = {
  staffId: "staff-1",
  operatorId: "op-1",
  role: "mate",
  name: "Bob",
};

describe("decodeMateToken", () => {
  it("returns the staff profile for a valid token", () => {
    const token = makeMateToken({ ...STAFF, exp: FUTURE });
    expect(decodeMateToken(token)).toEqual(STAFF);
  });

  it("returns null for an expired token", () => {
    const token = makeMateToken({ ...STAFF, exp: PAST });
    expect(decodeMateToken(token)).toBeNull();
  });

  it("returns the profile when exp is absent (no expiry)", () => {
    const token = makeMateToken(STAFF);
    expect(decodeMateToken(token)).toEqual(STAFF);
  });

  it("returns null when there is no dot separator", () => {
    expect(decodeMateToken("nodothere")).toBeNull();
  });

  it("returns null for invalid base64 data", () => {
    expect(decodeMateToken("!!!.sig")).toBeNull();
  });

  it("returns null for a non-JSON payload", () => {
    const b64 = Buffer.from("not-json")
      .toString("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=/g, "");
    expect(decodeMateToken(`${b64}.sig`)).toBeNull();
  });
});

describe("saveMateToken", () => {
  beforeEach(() => vi.clearAllMocks());

  it("delegates to SecureStore.setItemAsync", async () => {
    await saveMateToken("tok-xyz");
    expect(SecureStore.setItemAsync).toHaveBeenCalledWith("mate_token", "tok-xyz");
  });
});

describe("getMateToken", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns the stored token string", async () => {
    vi.mocked(SecureStore.getItemAsync).mockResolvedValueOnce("tok-xyz");
    expect(await getMateToken()).toBe("tok-xyz");
  });

  it("returns null when nothing is stored", async () => {
    vi.mocked(SecureStore.getItemAsync).mockResolvedValueOnce(null);
    expect(await getMateToken()).toBeNull();
  });
});

describe("clearMateToken", () => {
  beforeEach(() => vi.clearAllMocks());

  it("delegates to SecureStore.deleteItemAsync", async () => {
    await clearMateToken();
    expect(SecureStore.deleteItemAsync).toHaveBeenCalledWith("mate_token");
  });
});
