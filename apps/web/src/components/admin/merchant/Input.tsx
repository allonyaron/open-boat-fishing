"use client";

import {
  forwardRef,
  type InputHTMLAttributes,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
  type ReactNode,
} from "react";
import { Lamp } from "./StatusLight";

export function Label({ children, htmlFor }: { children: ReactNode; htmlFor?: string }) {
  return (
    <label htmlFor={htmlFor} className="block text-body-sm font-bold text-ob-ink mb-1.5">
      {children}
    </label>
  );
}

/** A 14px help line under a field (also used for the Locked explanation). */
export function HelpText({ children, id }: { children: ReactNode; id?: string }) {
  return (
    <p id={id} className="mt-1.5 text-meta text-ob-ink-3">
      {children}
    </p>
  );
}

/** Field error: a 10px alert lamp plus the message. Pair it with `invalid` on the field. */
export function FieldError({ children, id }: { children: ReactNode; id?: string }) {
  return (
    <p id={id} className="mt-1.5 flex items-center gap-2 text-body-sm font-bold text-ob-alert-ink">
      <Lamp tone="alert" size={10} />
      {children}
    </p>
  );
}

const FIELD =
  "w-full min-w-0 rounded-ob border-2 bg-ob-bg text-ob-ink placeholder:text-ob-ink-3 " +
  "disabled:bg-ob-panel-2 disabled:text-ob-ink-2 disabled:cursor-not-allowed";

function fieldClasses({ invalid, numeric, tall }: { invalid?: boolean; numeric?: boolean; tall?: boolean }) {
  return `${FIELD} ${tall ? "min-h-tap-main" : "min-h-field"} ${invalid ? "border-ob-alert" : "border-ob-control"} ${
    numeric ? "font-num text-18 px-3.5" : "text-body px-3.5"
  }`;
}

type FieldProps = {
  /** Red border; show a <FieldError> below and point aria-describedby at it. */
  invalid?: boolean;
  /** Plex Mono at 18px — numbers, times, money. */
  numeric?: boolean;
  /** 56px (the sign-in screen). */
  tall?: boolean;
};

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement> & FieldProps>(
  function Input({ className = "", invalid, numeric, tall, ...rest }, ref) {
    const isNumeric = numeric ?? (rest.type === "number" || rest.type === "time");
    return (
      <input
        ref={ref}
        aria-invalid={invalid || undefined}
        className={`${fieldClasses({ invalid, numeric: isNumeric, tall })} ${className}`}
        {...rest}
      />
    );
  },
);

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement> & FieldProps>(
  function Select({ className = "", children, invalid, tall, ...rest }, ref) {
    return (
      <select
        ref={ref}
        aria-invalid={invalid || undefined}
        className={`${fieldClasses({ invalid, tall })} ${className}`}
        {...rest}
      >
        {children}
      </select>
    );
  },
);

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement> & { invalid?: boolean }>(
  function Textarea({ className = "", invalid, ...rest }, ref) {
    return (
      <textarea
        ref={ref}
        aria-invalid={invalid || undefined}
        className={`${FIELD} min-h-[120px] px-3.5 py-3 text-body ${invalid ? "border-ob-alert" : "border-ob-control"} ${className}`}
        {...rest}
      />
    );
  },
);

/** −/+ 56px buttons around a centred number. */
export function Stepper({
  id,
  value,
  onChange,
  min = 0,
  max,
  decrementLabel,
  incrementLabel,
  invalid,
  describedBy,
}: {
  id: string;
  value: number;
  onChange: (n: number) => void;
  min?: number;
  max?: number;
  decrementLabel: string;
  incrementLabel: string;
  invalid?: boolean;
  describedBy?: string;
}) {
  const clamp = (n: number) => Math.max(min, max === undefined ? n : Math.min(max, n));
  const side =
    "w-14 min-h-tap-main flex-none flex items-center justify-center bg-ob-panel-2 text-ob-ink border-2 border-ob-control text-24 leading-none hover:bg-ob-panel disabled:opacity-45";
  return (
    <div className="flex items-stretch max-w-[260px]">
      <button
        type="button"
        aria-label={decrementLabel}
        aria-controls={id}
        disabled={value <= min}
        onClick={() => onChange(clamp(value - 1))}
        className={`${side} border-r-0 rounded-l-ob`}
      >
        −
      </button>
      <input
        id={id}
        type="number"
        inputMode="numeric"
        min={min}
        max={max}
        value={Number.isNaN(value) ? "" : value}
        aria-invalid={invalid || undefined}
        aria-describedby={describedBy}
        onChange={(e) => onChange(e.target.value === "" ? NaN : Number(e.target.value))}
        className={`flex-1 min-w-0 min-h-tap-main px-3 bg-ob-bg text-ob-ink border-2 ${
          invalid ? "border-ob-alert" : "border-ob-control"
        } font-num text-24 font-medium text-center [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none`}
      />
      <button
        type="button"
        aria-label={incrementLabel}
        aria-controls={id}
        disabled={max !== undefined && value >= max}
        onClick={() => onChange(clamp((Number.isNaN(value) ? min : value) + 1))}
        className={`${side} border-l-0 rounded-r-ob`}
      >
        +
      </button>
    </div>
  );
}
