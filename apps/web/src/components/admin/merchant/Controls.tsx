"use client";

import { useRef, type KeyboardEvent } from "react";
import { useDensity } from "./DensityContext";

/**
 * Segmented control: a 2px rule frame with a 2px inner gap; the selected
 * option is key-filled. A radiogroup, so arrow keys move the selection.
 */
export function Segmented<T extends string>({
  label,
  options,
  value,
  onChange,
  size,
  fill = false,
  className = "",
}: {
  /** Accessible name for the group, e.g. "Screen density". */
  label: string;
  options: readonly { value: T; label: string; count?: number }[];
  value: T;
  onChange: (v: T) => void;
  /** Defaults to the density height (Dock 48, Desk 36). */
  size?: "dock" | "desk";
  /** Stretch to the container, equal-width options. */
  fill?: boolean;
  className?: string;
}) {
  const { density } = useDensity();
  const h = (size ?? density) === "dock" ? "min-h-tap-dock text-body" : "min-h-tap-desk text-body-sm";
  const refs = useRef<(HTMLButtonElement | null)[]>([]);

  function onKeyDown(e: KeyboardEvent, i: number) {
    const delta = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 0;
    if (!delta) return;
    e.preventDefault();
    const next = (i + delta + options.length) % options.length;
    onChange(options[next].value);
    refs.current[next]?.focus();
  }

  return (
    <div
      role="radiogroup"
      aria-label={label}
      className={`${fill ? "grid" : "inline-flex"} border-2 border-ob-rule rounded-ob p-0.5 gap-0.5 ${className}`}
      style={fill ? { gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` } : undefined}
    >
      {options.map((o, i) => {
        const on = o.value === value;
        return (
          <button
            key={o.value}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="radio"
            aria-checked={on}
            tabIndex={on ? 0 : -1}
            onClick={() => onChange(o.value)}
            onKeyDown={(e) => onKeyDown(e, i)}
            className={`${h} inline-flex items-center justify-center gap-2 px-3.5 rounded-lamp font-bold whitespace-nowrap ${
              on ? "bg-ob-key text-ob-key-ink" : "bg-transparent text-ob-ink-2 hover:bg-ob-panel-2 hover:text-ob-ink"
            }`}
          >
            {o.label}
            {o.count !== undefined && <span className="font-num font-medium">{o.count}</span>}
          </button>
        );
      })}
    </div>
  );
}

/**
 * Switch: always shows the words Off / On; On is go-filled. Matches the
 * mockup's Settings switch, at the density's tap height (Dock 48, Desk 36).
 */
export function Switch({
  checked,
  onChange,
  label,
  labelledBy,
  id,
  disabled,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  /** Accessible name when there's no visible label to point at. */
  label?: string;
  /** id of the visible label. */
  labelledBy?: string;
  id?: string;
  disabled?: boolean;
}) {
  const { density } = useDensity();
  const seg = "min-w-12 self-stretch flex items-center justify-center px-2 text-body-sm font-extrabold";
  return (
    <button
      id={id}
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={labelledBy ? undefined : label}
      aria-labelledby={labelledBy}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`inline-flex items-stretch p-0.5 ${density === "dock" ? "min-h-tap-dock" : "min-h-tap-desk"} bg-ob-panel-2 border-2 border-ob-control rounded-ob disabled:opacity-45`}
    >
      <span aria-hidden="true" className={`${seg} ${checked ? "text-ob-ink-3" : "bg-ob-ink-2 text-ob-panel"}`}>
        Off
      </span>
      {/* go-ink, not go: identical in Console, and in Sunlight the darker green
          keeps white text at ~7:1 (white on go is 4.4:1). */}
      <span aria-hidden="true" className={`${seg} ${checked ? "bg-ob-go-ink text-ob-key-ink" : "text-ob-ink-3"}`}>
        On
      </span>
    </button>
  );
}

/** v1 name. */
export const Toggle = Switch;

/** "Active" + an Off/On switch, with an optional help line — Boat, Trip type and Person dialogs. */
export function ActiveSwitch({
  id,
  checked,
  onChange,
  help,
}: {
  id: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  help?: string;
}) {
  return (
    <div>
      <div className="flex items-center justify-between gap-4">
        <span id={`${id}-label`} className="text-body-sm font-bold">
          Active
        </span>
        <Switch id={id} checked={checked} onChange={onChange} labelledBy={`${id}-label`} />
      </div>
      {help && <p className="mt-1.5 text-meta text-ob-ink-3">{help}</p>}
    </div>
  );
}
