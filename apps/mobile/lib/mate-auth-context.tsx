import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { clearMateToken, getMateToken, type MateStaff, decodeMateToken } from './mate-auth';

type MateAuthCtx = {
  token: string | null;
  staff: MateStaff | null;
  /** Call after a successful login to update context + SecureStore. */
  setAuth: (token: string) => void;
  logout: () => Promise<void>;
  /** undefined = still loading from SecureStore */
  loading: boolean;
};

export const MateAuthContext = createContext<MateAuthCtx>({
  token: null,
  staff: null,
  setAuth: () => {},
  logout: async () => {},
  loading: true,
});

export function useMateAuth(): MateAuthCtx {
  return useContext(MateAuthContext);
}

export function MateAuthProvider({ children }: { children: React.ReactNode }) {
  const [token, setToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getMateToken().then((t) => {
      setToken(t);
      setLoading(false);
    });
  }, []);

  const setAuth = useCallback((t: string) => {
    setToken(t);
  }, []);

  const logout = useCallback(async () => {
    await clearMateToken();
    setToken(null);
  }, []);

  const staff = token ? decodeMateToken(token) : null;

  return (
    <MateAuthContext.Provider value={{ token, staff, setAuth, logout, loading }}>
      {children}
    </MateAuthContext.Provider>
  );
}
