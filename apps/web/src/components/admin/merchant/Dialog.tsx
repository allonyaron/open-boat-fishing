"use client";

import { useEffect, type ReactNode } from "react";

export function Dialog({
  open,
  onClose,
  title,
  footer,
  children,
  wide = false,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  footer: ReactNode;
  children: ReactNode;
  /** 600px instead of the default 520px — pattern / report / trip-type dialogs. */
  wide?: boolean;
}) {
  useEffect(() => {
    if (!open) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center bg-black/50 p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className={`flex max-h-[90vh] w-full flex-col rounded-2xl bg-white shadow-[0_8px_28px_rgba(0,0,0,0.2)] ${
          wide ? "max-w-[600px]" : "max-w-[520px]"
        }`}
      >
        <div className="flex items-center justify-between border-b border-merchant-hairline px-5 py-4">
          <div className="text-16 font-bold text-merchant-ink">{title}</div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="text-merchant-faint hover:text-merchant-ink text-lg leading-none"
          >
            ×
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-5">{children}</div>
        <div className="flex items-center justify-end gap-2 border-t border-merchant-hairline bg-merchant-fill px-5 py-3.5">
          {footer}
        </div>
      </div>
    </div>
  );
}
