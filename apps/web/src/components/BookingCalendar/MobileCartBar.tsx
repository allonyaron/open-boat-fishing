import { dollars } from "./format";

export function MobileCartBar({
  totalCents,
  totalSeats,
  onCheckout,
}: {
  totalCents: number;
  totalSeats: number;
  onCheckout: () => void;
}) {
  if (totalSeats === 0) return null;
  return (
    <div
      className="booking-mobile-bar hidden fixed inset-x-0 bottom-0 z-20 bg-hull items-center justify-between gap-[14px]"
      style={{ padding: "12px 18px" }}
    >
      <div>
        <div className="font-plex-mono text-[13px] tracking-[.14em] text-ink-dark-3">
          {totalSeats} {totalSeats === 1 ? "SEAT" : "SEATS"}
        </div>
        <div className="font-plex-mono text-[22px] font-bold text-white">{dollars(totalCents)}</div>
      </div>
      <button
        type="button"
        onClick={onCheckout}
        className="bg-orange text-white font-archivo text-[15px] font-bold tracking-[.08em] uppercase cursor-pointer hover:bg-orange-press transition-colors border-none"
        style={{ padding: "17px 24px" }}
      >
        Check out →
      </button>
    </div>
  );
}
