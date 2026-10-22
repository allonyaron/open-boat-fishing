"use client";

import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from "react";
import { Lamp } from "./StatusLight";

/** done = green light (it worked); error = red light (it couldn't). */
export type ToastKind = "done" | "error";

type ToastItem = { id: number; message: string; kind: ToastKind };

const ToastContext = createContext<{ showToast: (message: string, kind?: ToastKind) => void }>({
  showToast: () => {},
});

const AUTO_DISMISS_MS = 3800;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const nextId = useRef(0);

  const showToast = useCallback((message: string, kind: ToastKind = "done") => {
    const id = nextId.current++;
    setToasts((prev) => [...prev, { id, message, kind }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, AUTO_DISMISS_MS);
  }, []);

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}
      <div
        role="status"
        aria-live="polite"
        className="print:hidden fixed bottom-6 left-1/2 -translate-x-1/2 z-[60] flex flex-col items-center gap-2 pointer-events-none w-max max-w-[min(520px,calc(100vw-32px))]"
      >
        {toasts.map((t) => (
          <div
            key={t.id}
            className="pointer-events-auto flex items-center gap-3 px-[18px] py-3.5 bg-ob-panel text-ob-ink text-body rounded-ob shadow-toast animate-ob-toast-in"
          >
            <Lamp tone={t.kind === "error" ? "alert" : "go"} />
            <span className="[text-wrap:pretty]">
              {/* The red lamp is the only visual cue on a server message; say it in words too. */}
              {t.kind === "error" && <span className="sr-only">Couldn&rsquo;t do that: </span>}
              {t.message}
            </span>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  return useContext(ToastContext);
}
