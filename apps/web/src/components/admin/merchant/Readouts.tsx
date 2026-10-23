import type { ReactNode } from "react";

/**
 * A readout's big Plex Mono value. Its cap is the token size (readout-xl 52px,
 * readout-l 36px; one step down on phones); it only shrinks when the string
 * would not fit the cell — "$12,487.50" in a narrow cell — so money never clips.
 * Plex Mono is ~0.6em per glyph, which is what the fit is worked out from.
 */
export function ReadoutValue({
  children,
  size = "xl",
  className = "",
}: {
  children: string;
  size?: "xl" | "l";
  className?: string;
}) {
  const fit = `calc(100cqi / ${(0.6 * Math.max(children.length, 1)).toFixed(2)})`;
  const cap =
    size === "xl"
      ? "text-readout-xl [--readout-cap:52px] max-md:[--readout-cap:36px]"
      : "text-readout-l [--readout-cap:36px] max-md:[--readout-cap:30px]";
  return (
    <div
      className={`font-num tabular-nums whitespace-nowrap ${cap} ${className}`}
      style={{ fontSize: `min(var(--readout-cap), ${fit})` }}
    >
      {children}
    </div>
  );
}

/** A readout cell: the container its value is fitted to, with the 2px rule on its top and left. */
export function ReadoutCell({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={`flex flex-col gap-1 min-w-0 [container-type:inline-size] px-5 pt-[18px] pb-3.5 max-md:px-3.5 max-md:pt-3.5 max-md:pb-3 shadow-[-2px_0_0_0_var(--ob-rule),0_-2px_0_0_var(--ob-rule)] ${className}`}
    >
      {children}
    </div>
  );
}

/**
 * Stat readouts: cells in a ruled grid (2px rules between cells). Label
 * 15/600 ink-2, value readout-xl (36px on phones) in Plex Mono with tabular
 * numerals, optional 14px ink-3 sub-line.
 */
export function Readouts({ cells }: { cells: { label: string; value: string; sub?: ReactNode }[] }) {
  return (
    <div className="grid grid-cols-2 xl:grid-cols-4 bg-ob-panel border-2 border-ob-rule rounded-ob overflow-hidden">
      {cells.map((c) => (
        <ReadoutCell key={c.label}>
          <div className="text-body-sm font-semibold text-ob-ink-2">{c.label}</div>
          <ReadoutValue className="mt-1.5">{c.value}</ReadoutValue>
          <div className="text-meta text-ob-ink-3 min-h-5">{c.sub}</div>
        </ReadoutCell>
      ))}
    </div>
  );
}
