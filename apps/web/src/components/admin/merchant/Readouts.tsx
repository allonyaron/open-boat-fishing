import type { ReactNode } from "react";

/**
 * Stat readouts: cells in a ruled grid (2px rules between cells). Label
 * 15/600 ink-2, value readout-xl (36px on phones) in Plex Mono with tabular
 * numerals, optional 14px ink-3 sub-line.
 */
export function Readouts({ cells }: { cells: { label: string; value: ReactNode; sub?: ReactNode }[] }) {
  return (
    <div className="grid grid-cols-[repeat(auto-fit,minmax(160px,1fr))] bg-ob-panel border-2 border-ob-rule rounded-ob overflow-hidden">
      {cells.map((c) => (
        <div
          key={c.label}
          className="flex flex-col gap-1 min-w-0 px-5 pt-[18px] pb-3.5 max-md:px-3.5 max-md:pt-3.5 max-md:pb-3 shadow-[-2px_0_0_0_var(--ob-rule),0_-2px_0_0_var(--ob-rule)]"
        >
          <div className="text-body-sm font-semibold text-ob-ink-2">{c.label}</div>
          <div className="font-num text-readout-xl max-md:text-readout-l tabular-nums mt-1.5 truncate">{c.value}</div>
          <div className="text-meta text-ob-ink-3 min-h-5">{c.sub}</div>
        </div>
      ))}
    </div>
  );
}

