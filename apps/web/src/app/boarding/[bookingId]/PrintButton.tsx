"use client";

export function PrintButton() {
  return (
    <button
      onClick={() => window.print()}
      className="bg-[#0E7C7B] text-white text-sm font-semibold px-4 py-2 rounded-lg hover:bg-[#0B6B6A] transition-colors"
    >
      Print / Save PDF
    </button>
  );
}
