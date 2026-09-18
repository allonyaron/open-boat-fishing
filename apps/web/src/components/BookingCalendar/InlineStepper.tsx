export function InlineStepper({
  value,
  onDec,
  onInc,
  atMax,
  decLabel,
  incLabel,
}: {
  value: number;
  onDec: () => void;
  onInc: () => void;
  atMax: boolean;
  decLabel: string;
  incLabel: string;
}) {
  return (
    <div className="flex items-stretch flex-shrink-0" style={{ border: "1px solid #0d1c26", height: 44 }}>
      <button
        type="button"
        onClick={onDec}
        disabled={value === 0}
        aria-label={decLabel}
        className="flex items-center justify-center bg-white text-hull text-[18px] font-semibold cursor-pointer disabled:opacity-40 hover:bg-deck-3 transition-colors border-none"
        style={{ width: 44, borderRight: "1px solid #0d1c26" }}
      >
        −
      </button>
      <span
        className="flex items-center justify-center font-plex-mono text-[15px] font-semibold"
        style={{ minWidth: 44 }}
        aria-live="polite"
        aria-atomic="true"
      >
        {value}
      </span>
      <button
        type="button"
        onClick={onInc}
        disabled={atMax}
        aria-label={incLabel}
        className="flex items-center justify-center bg-hull text-white text-[18px] font-semibold cursor-pointer disabled:opacity-40 hover:bg-hull-2 transition-colors border-none"
        style={{ width: 44, borderLeft: "1px solid #0d1c26" }}
      >
        +
      </button>
    </div>
  );
}
