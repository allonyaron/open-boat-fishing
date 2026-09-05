"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

const NAV_LINKS = [
  { label: "Home", href: "/" },
  { label: "Book a Trip", href: "/book" },
  { label: "Fishing Reports", href: "/fishing-reports" },
] as const;

export function PublicNav({
  operatorName,
  phone,
}: {
  operatorName: string;
  phone: string | null;
}) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  return (
    <nav className="sticky top-0 z-50 bg-navy border-b border-white/10">
      <div className="max-w-7xl mx-auto px-6 h-[60px] flex items-center justify-between gap-4">
        {/* Logo */}
        <Link
          href="/"
          className="font-manrope text-16 font-bold text-white shrink-0 hover:text-white/90 transition-colors"
        >
          {operatorName}
        </Link>

        {/* Desktop links */}
        <div className="hidden md:flex items-center gap-7">
          {NAV_LINKS.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className={`text-14 font-medium transition-colors ${
                pathname === l.href
                  ? "text-gold"
                  : "text-white/65 hover:text-white"
              }`}
            >
              {l.label}
            </Link>
          ))}
        </div>

        {/* Desktop right */}
        <div className="hidden md:flex items-center gap-4 shrink-0">
          {phone && (
            <a
              href={`tel:${phone}`}
              className="text-13 text-white/55 hover:text-white/75 transition-colors"
            >
              {phone}
            </a>
          )}
          <Link
            href="/book"
            className="text-14 font-bold px-4 py-2 rounded-[9px] bg-gold text-navy hover:opacity-90 transition-opacity"
          >
            Book Now
          </Link>
        </div>

        {/* Mobile hamburger */}
        <button
          onClick={() => setOpen((v) => !v)}
          aria-label="Toggle menu"
          className="md:hidden p-2 text-white/70 hover:text-white transition-colors"
        >
          {open ? (
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="22"
              height="22"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          ) : (
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="22"
              height="22"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <line x1="3" y1="6" x2="21" y2="6" />
              <line x1="3" y1="12" x2="21" y2="12" />
              <line x1="3" y1="18" x2="21" y2="18" />
            </svg>
          )}
        </button>
      </div>

      {/* Mobile dropdown */}
      {open && (
        <div className="md:hidden bg-navy-medium border-t border-white/10 px-6 py-5 flex flex-col gap-4">
          {NAV_LINKS.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              onClick={() => setOpen(false)}
              className={`text-15 font-medium transition-colors ${
                pathname === l.href ? "text-gold" : "text-white/75 hover:text-white"
              }`}
            >
              {l.label}
            </Link>
          ))}
          <Link
            href="/book"
            onClick={() => setOpen(false)}
            className="mt-1 text-15 font-bold px-4 py-3 rounded-[9px] bg-gold text-navy text-center hover:opacity-90 transition-opacity"
          >
            Book Now
          </Link>
          {phone && (
            <a href={`tel:${phone}`} className="text-13 text-white/50 text-center">
              {phone}
            </a>
          )}
        </div>
      )}
    </nav>
  );
}
