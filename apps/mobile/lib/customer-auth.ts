import * as SecureStore from 'expo-secure-store';

const TOKEN_KEY = 'customer_token';

export type CustomerProfile = {
  customerId: string;
  operatorId: string;
  email: string;
  name: string | null;
  exp: number;
};

export async function saveCustomerToken(token: string): Promise<void> {
  await SecureStore.setItemAsync(TOKEN_KEY, token);
}

export async function getCustomerToken(): Promise<string | null> {
  return SecureStore.getItemAsync(TOKEN_KEY);
}

export async function clearCustomerToken(): Promise<void> {
  await SecureStore.deleteItemAsync(TOKEN_KEY);
}

export function decodeCustomerToken(token: string): CustomerProfile | null {
  try {
    const [data] = token.split('.');
    const payload = JSON.parse(
      Buffer.from(data.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8')
    ) as CustomerProfile & { exp: number };
    if (payload.exp < Date.now() / 1000) return null;
    return payload;
  } catch {
    return null;
  }
}
