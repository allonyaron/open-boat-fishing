export function EmptyState({ onNextMonth }: { onNextMonth: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center py-24 text-center">
      <div
        className="font-plex-mono text-[13px] font-semibold tracking-[.1em] mb-3"
        style={{ color: "#5b6f79" }}
      >
        NO TRIPS THIS MONTH
      </div>
      <button
        type="button"
        onClick={onNextMonth}
        className="font-plex-mono text-[13px] font-semibold underline hover:opacity-75 transition-opacity tracking-[.08em]"
        style={{ color: "#8c3b12" }}
      >
        SEE NEXT AVAILABLE MONTH →
      </button>
    </div>
  );
}
