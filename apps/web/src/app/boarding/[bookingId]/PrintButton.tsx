"use client";

export function PrintButton() {
  return (
    <button
      onClick={() => window.print()}
      className="bg-gold text-navy text-sm font-semibold px-4 py-2 rounded-lg hover:bg-gold-hover transition-colors"
    >
      Print / Save PDF
    </button>
  );
}
