"use client";

import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import { useDensity } from "./DensityContext";
import { StopIcon } from "./icons";
import { useInDialogFooter } from "./Dialog";

/**
 * - key: the lit primary key, one per screen.
 * - strong: per-row main action (Who's coming, All aboard).
 * - secondary: everything else.
 * - danger: Cancel / Refund on a row. Always opens a confirm; always has an icon.
 * - danger-confirm: only inside a dialog, with the count or amount in the label.
 */
export type ButtonVariant = "key" | "strong" | "secondary" | "danger" | "danger-confirm";

/**
 * - auto: follows density — Dock 48px, Desk 36px.
 * - dock: 48px in both densities (page-head actions, as the Desk frames show them).
 * - field: 52px, dialog footers (the default inside one; lines up with 52px inputs).
 * - main: 56px, the main action on a phone screen.
 */
export type ButtonSize = "auto" | "dock" | "field" | "main";

export const BUTTON_VARIANT_CLASSES: Record<ButtonVariant, string> = {
  key: "bg-ob-key text-ob-key-ink border-ob-key hover:bg-ob-key-hover hover:border-ob-key-hover",
  strong: "bg-transparent text-ob-ink border-ob-ink hover:bg-ob-panel-2",
  secondary: "bg-transparent text-ob-ink border-ob-control hover:bg-ob-panel-2",
  danger: "bg-transparent text-ob-alert-ink border-ob-alert hover:bg-ob-alert-tint",
  "danger-confirm":
    "bg-ob-alert-fill text-white border-ob-alert-fill hover:bg-ob-alert-fill-hover hover:border-ob-alert-fill-hover",
};

const BASE =
  "inline-flex items-center justify-center gap-2.5 rounded-ob border-2 font-bold whitespace-nowrap cursor-pointer " +
  "disabled:opacity-45 disabled:cursor-not-allowed disabled:pointer-events-none";

export function buttonSizeClasses(size: ButtonSize, density: "dock" | "desk"): string {
  if (size === "main") return "min-h-tap-main px-5 text-body";
  if (size === "field") return "min-h-field px-5 text-body";
  if (size === "dock") return "min-h-tap-dock px-[18px] text-body";
  return density === "dock" ? "min-h-tap-dock px-4 text-body" : "min-h-tap-desk px-3 text-body-sm";
}

type Props = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Leading icon. Danger buttons get the stop icon unless another is given; `false` = none (Desk tables). */
  icon?: ReactNode | false;
  /** Trailing icon (e.g. a chevron on "Post the report ›"). */
  iconAfter?: ReactNode;
};

export const Button = forwardRef<HTMLButtonElement, Props>(function Button(
  { variant = "secondary", size, icon, iconAfter, className = "", type = "button", children, ...rest },
  ref,
) {
  const { density } = useDensity();
  const inFooter = useInDialogFooter();
  const resolvedSize = size ?? (inFooter ? "field" : "auto");
  const lead = icon === false ? null : icon ?? (variant === "danger" || variant === "danger-confirm" ? <StopIcon /> : null);
  return (
    <button
      ref={ref}
      type={type}
      className={`${BASE} ${buttonSizeClasses(resolvedSize, density)} ${BUTTON_VARIANT_CLASSES[variant]} ${className}`}
      {...rest}
    >
      {lead}
      {children}
      {iconAfter}
    </button>
  );
});

/** Inline text action ("Change", "Pause"). Kept for screens still on the v1 layout. */
export const TextButton = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement>>(
  function TextButton({ className = "", type = "button", ...rest }, ref) {
    const { density } = useDensity();
    return (
      <button
        ref={ref}
        type={type}
        className={`inline-flex items-center ${density === "dock" ? "min-h-tap-dock" : "min-h-tap-desk"} text-body-sm font-bold text-ob-ink underline underline-offset-[3px] hover:text-ob-ink-2 disabled:opacity-45 disabled:pointer-events-none ${className}`}
        {...rest}
      />
    );
  },
);
