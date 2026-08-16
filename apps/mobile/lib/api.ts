import Constants from "expo-constants";

export function getApiUrl(): string {
  if (process.env.EXPO_PUBLIC_API_URL) return process.env.EXPO_PUBLIC_API_URL;
  if (typeof __DEV__ !== "undefined" && __DEV__) {
    const host = (Constants.expoConfig as { hostUri?: string } | null)?.hostUri?.split(":")[0];
    if (host) return `http://${host}:3000`;
  }
  throw new Error("EXPO_PUBLIC_API_URL must be set for production builds");
}

export const API_URL = getApiUrl();
