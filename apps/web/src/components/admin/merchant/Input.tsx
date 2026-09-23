import { forwardRef, type InputHTMLAttributes, type SelectHTMLAttributes, type ReactNode } from "react";

export function Label({ children, htmlFor }: { children: ReactNode; htmlFor?: string }) {
  return (
    <label htmlFor={htmlFor} className="block text-13 text-merchant-ink mb-1">
      {children}
    </label>
  );
}

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  function Input({ className = "", ...rest }, ref) {
    return (
      <input
        ref={ref}
        className={`w-full rounded-lg border border-merchant-input px-2.5 py-2.5 text-14 text-merchant-ink placeholder:text-merchant-faint focus:outline-none focus:ring-2 focus:ring-merchant-blue-tint focus:border-merchant-blue ${className}`}
        {...rest}
      />
    );
  },
);

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(
  function Select({ className = "", children, ...rest }, ref) {
    return (
      <select
        ref={ref}
        className={`w-full rounded-lg border border-merchant-input px-2.5 py-2.5 text-14 text-merchant-ink focus:outline-none focus:ring-2 focus:ring-merchant-blue-tint focus:border-merchant-blue ${className}`}
        {...rest}
      >
        {children}
      </select>
    );
  },
);

/** 44x24 track, 20px knob toggle — used for "seats left shown", active flags, etc. */
export function Toggle({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
        checked ? "bg-merchant-chrome-mid" : "bg-merchant-control"
      }`}
    >
      <span
        className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${
          checked ? "translate-x-[22px]" : "translate-x-0.5"
        }`}
      />
    </button>
  );
}
