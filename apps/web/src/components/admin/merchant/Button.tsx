"use client";

import { forwardRef, type ButtonHTMLAttributes } from "react";
import { useDensity, densityMinHeight } from "./DensityContext";

type Variant = "primary" | "secondary" | "destructive";

const VARIANT_CLASSES: Record<Variant, string> = {
  primary: "bg-merchant-chrome-mid text-white border border-transparent hover:opacity-90",
  secondary:
    "bg-gradient-to-b from-white to-merchant-fill text-merchant-ink border border-merchant-control hover:bg-merchant-fill",
  destructive: "bg-merchant-red text-white border border-transparent hover:opacity-90",
};

type Props = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
};

export const Button = forwardRef<HTMLButtonElement, Props>(function Button(
  { variant = "secondary", className = "", style, disabled, ...rest },
  ref,
) {
  const { density } = useDensity();
  return (
    <button
      ref={ref}
      disabled={disabled}
      style={{ minHeight: densityMinHeight(density), ...style }}
      className={`inline-flex items-center justify-center gap-1.5 rounded-lg px-3.5 text-13 font-semibold transition-opacity disabled:opacity-50 disabled:pointer-events-none ${VARIANT_CLASSES[variant]} ${className}`}
      {...rest}
    />
  );
});

/** Plain text-style button for inline row actions ("List", "Seats", "Cancel"). */
export const TextButton = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement>>(
  function TextButton({ className = "", ...rest }, ref) {
    return (
      <button
        ref={ref}
        className={`text-13 font-semibold text-merchant-blue hover:underline disabled:opacity-50 disabled:pointer-events-none ${className}`}
        {...rest}
      />
    );
  },
);
