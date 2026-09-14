import Link from "next/link";

export function SiteHeader({
  operatorName,
  phone,
  dockAddress,
}: {
  operatorName: string;
  phone: string | null;
  dockAddress: string | null;
}) {
  return (
    <>
      {(phone || dockAddress) && (
        <div
          className="bg-hull font-plex-mono text-[12px] tracking-[.1em] text-ink-dark-3 flex flex-wrap gap-3 justify-between"
          style={{ padding: "9px 28px" }}
        >
          <span>{dockAddress ?? ""}</span>
          {phone && <span>QUESTIONS? {phone}</span>}
        </div>
      )}
      <div
        className="bg-hull flex items-center justify-between gap-6"
        style={{ borderBottom: "3px solid #c94510", padding: "16px 28px" }}
      >
        <Link
          href="/"
          className="font-archivo text-[22px] font-bold tracking-[.05em] text-white uppercase hover:text-white/90 transition-colors"
        >
          {operatorName}
        </Link>
        <div className="flex items-center gap-6">
          <Link
            href="/fishing-reports"
            className="font-plex-mono text-[12px] tracking-[.1em] text-ink-dark-2 hover:text-white transition-colors hidden sm:block"
          >
            FISHING REPORTS
          </Link>
          <Link
            href="/book"
            className="font-plex-mono text-[12px] font-semibold tracking-[.1em] text-white bg-orange hover:bg-orange-press transition-colors"
            style={{ padding: "11px 20px" }}
          >
            BOOK A SEAT
          </Link>
        </div>
      </div>
    </>
  );
}
