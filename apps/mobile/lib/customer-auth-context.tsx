import React, { createContext, useContext, useEffect, useState } from "react";
import {
  getCustomerToken,
  clearCustomerToken,
  decodeCustomerToken,
  type CustomerProfile,
} from "./customer-auth";

type CustomerAuthCtx = {
  token: string | null;
  customer: CustomerProfile | null;
  loading: boolean;
  setAuth: (token: string) => void;
  logout: () => Promise<void>;
};

const Ctx = createContext<CustomerAuthCtx>({
  token: null,
  customer: null,
  loading: true,
  setAuth: () => {},
  logout: async () => {},
});

export function CustomerAuthProvider({ children }: { children: React.ReactNode }) {
  const [token, setToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getCustomerToken().then((t) => {
      if (t && decodeCustomerToken(t)) setToken(t);
      setLoading(false);
    });
  }, []);

  const setAuth = (t: string) => setToken(t);

  const logout = async () => {
    await clearCustomerToken();
    setToken(null);
  };

  const customer = token ? decodeCustomerToken(token) : null;

  return (
    <Ctx.Provider value={{ token, customer, loading, setAuth, logout }}>{children}</Ctx.Provider>
  );
}

export function useCustomerAuth() {
  return useContext(Ctx);
}
