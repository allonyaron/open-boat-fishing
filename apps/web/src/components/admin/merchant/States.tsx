"use client";

import type { ReactNode } from "react";
import { Button } from "./Button";
import { Lamp } from "./StatusLight";

/** Empty: a hollow lamp, an 18/800 line, a 16px ink-2 explanation, plus an action where the code has one. */
export function EmptyState({
  title,
  body,
  action,
  className = "",
}: {
  title: ReactNode;
  body?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={`flex flex-col items-start gap-1.5 px-5 py-10 ${className}`}>
      <div className="flex items-center gap-2.5">
        <Lamp tone="ink-3" shape="hollow" />
        <span className="text-18 font-extrabold text-ob-ink">{title}</span>
      </div>
      {body && <div className="text-body text-ob-ink-2 max-w-[52ch] [text-wrap:pretty]">{body}</div>}
      {action && <div className="mt-3">{action}</div>}
    </div>
  );
}

/**
 * Loading: panel-2 shimmer blocks plus a "Loading…" line. The shimmer stops
 * under reduced motion (tokens' prefers-reduced-motion rule).
 */
export function LoadingState({
  label = "Loading…",
  rows = 4,
  variant = "rows",
}: {
  /** The visible line, e.g. "Loading today's trips…". */
  label?: string;
  rows?: number;
  /** rows = time block + two text lines (trip lists); blocks = a title line over a tall block. */
  variant?: "rows" | "blocks";
}) {
  const shimmer = "bg-ob-panel-2 rounded-ob animate-ob-shimmer";
  return (
    <div aria-busy="true" className="flex flex-col">
      {Array.from({ length: rows }, (_, i) =>
        variant === "rows" ? (
          <div key={i} aria-hidden="true" className="flex items-center gap-5 px-5 py-[22px] border-t border-ob-hair first:border-t-0">
            <div className={`w-[72px] h-7 flex-none ${shimmer}`} />
            <div className="flex-1 flex flex-col gap-2">
              <div className={`w-2/5 h-4 ${shimmer}`} />
              <div className={`w-1/4 h-3 ${shimmer}`} />
            </div>
          </div>
        ) : (
          <div key={i} aria-hidden="true" className="flex flex-col gap-2.5 p-5 border-t border-ob-hair first:border-t-0">
            <div className={`w-1/3 h-[18px] ${shimmer}`} />
            <div className={`w-[56%] h-12 ${shimmer}`} />
          </div>
        ),
      )}
      <div role="status" className="px-5 pt-3 pb-4 text-body-sm text-ob-ink-3">
        {label}
      </div>
    </div>
  );
}

/**
 * Error: alert-tint panel with a 2px alert border, the code's "Can't reach
 * the booking system" copy, plus Try again (strong).
 */
export function ErrorState({
  body,
  onRetry,
  title = "Can’t reach the booking system",
}: {
  body: ReactNode;
  onRetry: () => void;
  title?: string;
}) {
  return (
    <div role="alert" className="flex items-start gap-4 p-5 bg-ob-alert-tint border-2 border-ob-alert rounded-ob">
      <Lamp tone="alert" className="mt-1.5" />
      <div className="flex-1 min-w-0">
        <div className="text-18 font-extrabold text-ob-ink">{title}</div>
        <p className="mt-1 mb-4 text-body text-ob-ink-2 max-w-[60ch] [text-wrap:pretty]">{body}</p>
        <Button variant="strong" onClick={onRetry}>
          Try again
        </Button>
      </div>
    </div>
  );
}
