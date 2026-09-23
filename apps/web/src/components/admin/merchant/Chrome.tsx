"use client";

import { useState } from "react";
import Link from "next/link";
import { useDensity } from "./DensityContext";

// Target IA per the redesign. Screens not built yet either fall back to the
// still-functional old page at a different URL, or — where no old equivalent
// exists — render disabled rather than as a dead link, since this app is
// live on a public demo mid-rollout.
const NAV: { href: string; label: string; disabled?: boolean }[] = [
  { href: "/admin", label: "Today" },
  { href: "/admin/calendar", label: "Calendar" },
  { href: "/admin/settings/schedules", label: "Weekly schedule" }, // old page — Phase 6 moves this to /admin/schedule
  { href: "/admin/reports", label: "Reports", disabled: true }, // Phase 7
  { href: "/admin/revenue", label: "Money" }, // old page — Phase 8 moves this to /admin/money
  { href: "/admin/settings", label: "Settings" },
];

function isActive(href: string, pathname: string) {
  return href === "/admin" ? pathname === "/admin" : pathname.startsWith(href);
}

function NavList({ pathname, onNav }: { pathname: string; onNav: () => void }) {
  return (
    <nav className="flex flex-col gap-0.5">
      {NAV.map(({ href, label, disabled }) => {
        if (disabled) {
          return (
            <div
              key={href}
              className="flex items-center gap-2.5 rounded-lg px-2.5 py-2.5 text-13 text-merchant-disabled cursor-default"
              title="Coming soon"
            >
              <span className="w-[7px] h-[7px] rounded-[2px] flex-shrink-0 bg-merchant-disabled" />
              {label}
              <span className="ml-auto text-11 text-merchant-disabled">soon</span>
            </div>
          );
        }
        const active = isActive(href, pathname);
        return (
          <Link
            key={href}
            href={href}
            onClick={onNav}
            className={`flex items-center gap-2.5 rounded-lg px-2.5 py-2.5 text-13 ${
              active ? "bg-merchant-hairline font-semibold text-merchant-ink" : "font-normal text-merchant-ink hover:bg-merchant-fill-3"
            }`}
          >
            <span
              className="w-[7px] h-[7px] rounded-[2px] flex-shrink-0"
              style={{ backgroundColor: active ? "#303030" : "#c9c9c9" }}
            />
            {label}
          </Link>
        );
      })}
    </nav>
  );
}

function DensityToggle() {
  const { density, setDensity } = useDensity();
  return (
    <div className="inline-flex rounded-lg bg-merchant-chrome-mid p-0.5">
      {(["dock", "desk"] as const).map((d) => (
        <button
          key={d}
          onClick={() => setDensity(d)}
          className={`rounded-md px-2.5 py-1 text-12 font-semibold transition-colors ${
            density === d ? "bg-white text-merchant-chrome" : "text-[#b5b5b5]"
          }`}
        >
          {d === "dock" ? "Dock view" : "Desk view"}
        </button>
      ))}
    </div>
  );
}

function UserChip({ name, onLogout }: { name: string; onLogout: () => void }) {
  return (
    <div className="flex items-center gap-2 rounded-lg bg-merchant-chrome-mid px-2 py-1">
      <div className="w-6 h-6 rounded-md bg-merchant-chrome-light flex items-center justify-center text-11 font-bold text-white flex-shrink-0">
        {name.charAt(0).toUpperCase()}
      </div>
      <span className="text-13 text-[#e3e3e3] hidden sm:inline">{name}</span>
      <button
        onClick={onLogout}
        className="rounded-md bg-merchant-chrome-light px-2.5 py-1 text-12 font-semibold text-white hover:opacity-90"
      >
        Sign out
      </button>
    </div>
  );
}

export function Chrome({
  me,
  pathname,
  onLogout,
  children,
}: {
  me: { name: string };
  pathname: string;
  onLogout: () => void;
  children: React.ReactNode;
}) {
  const [drawerOpen, setDrawerOpen] = useState(false);

  return (
    <div className="min-h-screen bg-merchant-page text-merchant-ink">
      <header className="print:hidden sticky top-0 z-20 flex items-center justify-between bg-merchant-chrome px-4 py-2.5">
        <div className="flex items-center gap-3">
          <button
            onClick={() => setDrawerOpen(true)}
            aria-label="Open menu"
            className="md:hidden text-white/70 hover:text-white p-1 -ml-1"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <line x1="3" y1="6" x2="21" y2="6" />
              <line x1="3" y1="12" x2="21" y2="12" />
              <line x1="3" y1="18" x2="21" y2="18" />
            </svg>
          </button>
          <span className="text-14 font-semibold text-white">Open Boat</span>
        </div>
        <div className="flex items-center gap-3">
          <DensityToggle />
          <UserChip name={me.name} onLogout={onLogout} />
        </div>
      </header>

      {drawerOpen && (
        <div className="fixed inset-0 z-30 bg-black/50 md:hidden" onClick={() => setDrawerOpen(false)} />
      )}
      <aside
        className={`fixed top-0 left-0 z-40 h-full w-64 bg-merchant-page p-4 transition-transform duration-200 md:hidden ${
          drawerOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <NavList pathname={pathname} onNav={() => setDrawerOpen(false)} />
      </aside>

      <div className="mx-auto max-w-[1280px] grid grid-cols-1 md:grid-cols-[216px_minmax(0,1fr)] print:block">
        <aside className="print:hidden hidden md:block p-4">
          <NavList pathname={pathname} onNav={() => {}} />
          <div className="mt-3 rounded-xl border border-merchant-hairline bg-white p-3 text-13 text-merchant-muted">
            Everything is Eastern time
            <div className="mt-1 text-12 text-merchant-faint">
              Type times the way you say them. We handle the clock change in the fall.
            </div>
          </div>
        </aside>
        <main className="p-4 pb-20 md:pl-1 min-w-0">{children}</main>
      </div>
    </div>
  );
}
