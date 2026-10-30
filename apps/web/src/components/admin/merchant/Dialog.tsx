"use client";

import { createContext, useContext, useEffect, useId, useRef, type ReactNode } from "react";
import { CloseIcon, WarningIcon } from "./icons";
import { Lamp } from "./StatusLight";

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Buttons in a dialog footer default to the 52px field height. */
const DialogFooterContext = createContext(false);
export function useInDialogFooter() {
  return useContext(DialogFooterContext);
}

/**
 * Centred dialog on desktop; a bottom sheet with stacked full-width buttons
 * (primary on top) under 768px. Escape and a scrim click close it. Focus moves
 * into the dialog on open, stays there while it's open, and returns to
 * whatever opened it on close.
 *
 * Footer order: pass Cancel first, then the primary — desktop shows them
 * left-to-right, the sheet stacks the primary on top.
 */
export function Dialog({
  open,
  onClose,
  title,
  subtitle,
  footer,
  children,
  wide = false,
  danger = false,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  /** A line under the title — e.g. which trip a report is for. */
  subtitle?: ReactNode;
  footer: ReactNode;
  children: ReactNode;
  /** 620px instead of 540px — pattern / report / trip-type dialogs. */
  wide?: boolean;
  /** Destructive: a red lamp before the title. Pair with <CautionBox>. */
  danger?: boolean;
}) {
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    const opener = document.activeElement as HTMLElement | null;
    const first = bodyRef.current?.querySelector<HTMLElement>(FOCUSABLE);
    (first ?? panelRef.current)?.focus();

    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.stopPropagation();
        onCloseRef.current();
        return;
      }
      if (e.key !== "Tab" || !panelRef.current) return;
      const items = [...panelRef.current.querySelectorAll<HTMLElement>(FOCUSABLE)];
      if (items.length === 0) return;
      const firstItem = items[0];
      const lastItem = items[items.length - 1];
      if (e.shiftKey && document.activeElement === firstItem) {
        e.preventDefault();
        lastItem.focus();
      } else if (!e.shiftKey && document.activeElement === lastItem) {
        e.preventDefault();
        firstItem.focus();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = prevOverflow;
      if (opener && document.contains(opener)) opener.focus();
    };
  }, [open]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-ob-scrim max-md:items-end max-md:p-0"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={`flex w-full flex-col bg-ob-panel text-ob-ink rounded-ob shadow-dialog max-h-[calc(100dvh-32px)] focus:outline-none ${
          wide ? "max-w-[620px]" : "max-w-[540px]"
        } max-md:max-w-none max-md:max-h-[92dvh]`}
      >
        <div className="flex items-center justify-between gap-3 min-h-16 py-2 pl-6 pr-2 border-b-2 border-ob-rule max-md:pl-4">
          <div className="flex items-center gap-3 min-w-0">
            {danger && <Lamp tone="alert" />}
            <div className="min-w-0">
              <h2 id={titleId} className="text-title-panel text-ob-ink">
                {title}
              </h2>
              {subtitle && <div className="text-body-sm text-ob-ink-2">{subtitle}</div>}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex items-center justify-center w-12 h-12 flex-none text-ob-ink-2 hover:text-ob-ink"
          >
            <CloseIcon />
          </button>
        </div>
        <div ref={bodyRef} className="flex-1 overflow-y-auto px-6 pt-5 pb-6 flex flex-col gap-[18px] max-md:px-4">
          {children}
        </div>
        <div className="flex flex-wrap justify-end gap-3 px-6 py-4 border-t-2 border-ob-rule bg-ob-panel-2 max-md:flex-col-reverse max-md:px-4 max-md:[&>*]:w-full">
          <DialogFooterContext.Provider value={true}>{footer}</DialogFooterContext.Provider>
        </div>
      </div>
    </div>
  );
}

/** The caution box every destructive dialog carries ("… This cannot be undone."). */
export function CautionBox({ children }: { children: ReactNode }) {
  return (
    <div className="flex gap-3 px-3.5 py-3 bg-ob-caution-tint border-2 border-ob-caution text-body-sm text-ob-ink">
      <span className="text-ob-caution-ink mt-px">
        <WarningIcon />
      </span>
      <span className="[text-wrap:pretty]">{children}</span>
    </div>
  );
}

/** The trip / ticket summary block at the top of the Cancel and Refund dialogs. */
export function SummaryBox({ title, sub, aside }: { title: ReactNode; sub?: ReactNode; aside?: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 px-3.5 py-3 bg-ob-panel-2 border border-ob-hair">
      <div className="min-w-0">
        <div className="text-17 font-bold">{title}</div>
        {sub && <div className="text-body-sm text-ob-ink-2">{sub}</div>}
      </div>
      {aside && <div className="font-num text-24 font-medium flex-none">{aside}</div>}
    </div>
  );
}
