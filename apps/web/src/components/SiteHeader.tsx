import Link from "next/link";
import { CartNavButton } from "@/components/CartNavButton";

export function SiteHeader({
  operatorName,
  phone,
  dockAddress,
  navLinks,
  mobileLeftLabel,
  mobileLeftHref,
  mobileRightLabel,
}: {
  operatorName: string;
  phone?: string | null;
  dockAddress?: string | null;
  navLinks?: { label: string; href: string; active?: boolean }[];
  mobileLeftLabel?: string;
  mobileLeftHref?: string;
  mobileRightLabel?: string;
}) {
  const isHomepage = !mobileLeftHref;

  return (
    <>
      {/* ── Mobile header (< lg) ─────────────────────────────── */}
      <div
        className="lg:hidden sticky top-0 z-50 flex items-center justify-between bg-hull"
        style={{ height: 54, padding: "0 16px", borderBottom: "3px solid #c94510" }}
      >
        {isHomepage ? (
          <Link
            href="/"
            className="font-archivo font-bold uppercase text-white"
            style={{ fontSize: 17, letterSpacing: ".04em", textDecoration: "none" }}
          >
            {operatorName}
          </Link>
        ) : (
          <Link
            href={mobileLeftHref}
            className="font-plex-mono font-semibold tracking-[.1em] uppercase"
            style={{ fontSize: 12, color: "#dfe8ec", textDecoration: "none" }}
          >
            ← {mobileLeftLabel}
          </Link>
        )}

        {isHomepage ? (
          <CartNavButton />
        ) : (
          <span
            className="font-plex-mono"
            style={{ fontSize: 11, letterSpacing: ".14em", color: "#c9d6dd" }}
          >
            {mobileRightLabel}
          </span>
        )}
      </div>

      {/* ── Desktop header (≥ lg) ────────────────────────────── */}
      <div className="hidden lg:block">
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
            {navLinks?.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className="font-plex-mono text-[12px] tracking-[.1em] transition-colors hidden xl:block"
                style={{ color: link.active ? "#fff" : "#b6c6ce", textDecoration: "none" }}
              >
                {link.label}
              </Link>
            ))}
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
      </div>
    </>
  );
}
