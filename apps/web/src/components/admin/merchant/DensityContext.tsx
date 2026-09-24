"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

export type Density = "dock" | "desk";

const STORAGE_KEY = "openboat_admin_density";

const DensityContext = createContext<{
  density: Density;
  setDensity: (d: Density) => void;
}>({ density: "dock", setDensity: () => {} });

export function DensityProvider({ children }: { children: ReactNode }) {
  const [density, setDensityState] = useState<Density>("dock");

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(STORAGE_KEY);
      if (stored === "dock" || stored === "desk") setDensityState(stored);
    } catch {
      // Private window / blocked storage — fall back to the default.
    }
  }, []);

  function setDensity(d: Density) {
    setDensityState(d);
    try {
      window.localStorage.setItem(STORAGE_KEY, d);
    } catch {
      // Best-effort persistence only.
    }
  }

  return <DensityContext.Provider value={{ density, setDensity }}>{children}</DensityContext.Provider>;
}

export function useDensity() {
  return useContext(DensityContext);
}

/** Minimum interactive-target height for the current density. */
export function densityMinHeight(density: Density): string {
  return density === "dock" ? "46px" : "38px";
}
