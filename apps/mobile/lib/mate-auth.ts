import * as SecureStore from "expo-secure-store";

const TOKEN_KEY = "mate_token";

export type MateStaff = {
  staffId: string;
  operatorId: string;
  role: string;
  name: string;
};

export async function saveMateToken(token: string): Promise<void> {
  await SecureStore.setItemAsync(TOKEN_KEY, token);
}

export async function getMateToken(): Promise<string | null> {
  return SecureStore.getItemAsync(TOKEN_KEY);
}

export async function clearMateToken(): Promise<void> {
  await SecureStore.deleteItemAsync(TOKEN_KEY);
}

// Decode the payload portion of the signed mate token (base64url-encoded JSON).
// Does NOT verify the signature — only used client-side to read display fields.
export function decodeMateToken(token: string): MateStaff | null {
  try {
    const dot = token.lastIndexOf(".");
    if (dot < 0) return null;
    const data = token.slice(0, dot);
    // base64url → base64 → JSON
    const b64 = data.replace(/-/g, "+").replace(/_/g, "/");
    const padding = (4 - (b64.length % 4)) % 4;
    const padded = b64 + "=".repeat(padding);
    const json = atob(padded);
    const payload = JSON.parse(json) as Record<string, unknown>;
    if (typeof payload.exp === "number" && payload.exp < Date.now() / 1000) return null;
    return {
      staffId: payload.staffId as string,
      operatorId: payload.operatorId as string,
      role: payload.role as string,
      name: payload.name as string,
    };
  } catch {
    return null;
  }
}
