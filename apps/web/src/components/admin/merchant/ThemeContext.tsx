"use client";

import { createContext, useContext, useEffect, useLayoutEffect, useState, type ReactNode } from "react";

export type Theme = "console" | "sunlight";

const STORAGE_KEY = "openboat_admin_theme";

// useLayoutEffect warns during server rendering; it only matters in the browser.
const useClientLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

const ThemeContext = createContext<{
  theme: Theme;
  setTheme: (t: Theme) => void;
}>({ theme: "console", setTheme: () => {} });

/**
 * Console (dark, default) or Sunlight (high-contrast light), remembered per
 * device like density. The tokens hang off data-ob-theme on <html>; it is set
 * only while the admin is mounted, so the public site never picks up the
 * admin's focus ring, selection colour or reduced-motion rules.
 */
export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>("console");

  // Layout effect: read the saved theme before the first client paint.
  useClientLayoutEffect(() => {
    try {
      const stored = window.localStorage.getItem(STORAGE_KEY);
      if (stored === "console" || stored === "sunlight") setThemeState(stored);
    } catch {
      // Private window / blocked storage — fall back to the default.
    }
  }, []);

  useClientLayoutEffect(() => {
    const root = document.documentElement;
    root.dataset.obTheme = theme;
    root.style.colorScheme = theme === "sunlight" ? "light" : "dark";
    return () => {
      delete root.dataset.obTheme;
      root.style.colorScheme = "";
    };
  }, [theme]);

  function setTheme(t: Theme) {
    setThemeState(t);
    try {
      window.localStorage.setItem(STORAGE_KEY, t);
    } catch {
      // Best-effort persistence only.
    }
  }

  return <ThemeContext.Provider value={{ theme, setTheme }}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  return useContext(ThemeContext);
}
