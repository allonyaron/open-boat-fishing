"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useDensity, type Density } from "./DensityContext";
import { useTheme } from "./ThemeContext";
import { Segmented } from "./Controls";
import { Lamp } from "./StatusLight";
import { CloseIcon, MenuIcon, SunIcon } from "./icons";

const NAV: { href: string; label: string }[] = [
  { href: "/admin", label: "Today" },
  { href: "/admin/calendar", label: "Calendar" },
  { href: "/admin/schedule", label: "Weekly schedule" },
  { href: "/admin/reports", label: "Reports" },
  { href: "/admin/money", label: "Money" },
  { href: "/admin/settings", label: "Settings" },
];

const DENSITY_OPTIONS = [
  { value: "dock", label: "Dock view" },
  { value: "desk", label: "Desk view" },
] as const satisfies readonly { value: Density; label: string }[];

function isActive(href: string, pathname: string) {
  return href === "/admin" ? pathname === "/admin" : pathname.startsWith(href);
}

/** Trips that sailed and still need a fishing report — the Reports nav badge. */
function useReportsOwed(pathname: string): number {
  const [count, setCount] = useState(0);
  useEffect(() => {
    let live = true;
    fetch("/api/admin/reports/pending")
      .then((r) => (r.ok ? r.json() : []))
      .then((rows: unknown[]) => live && setCount(Array.isArray(rows) ? rows.length : 0))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [pathname]);
  return count;
}

const ET_DAY = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  weekday: "short",
  month: "short",
  day: "numeric",
});
const ET_TIME = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "numeric", minute: "2-digit" });

/** The top bar's Eastern-time readout. Client-only so server and browser never disagree on the minute. */
function EtClock() {
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    setNow(new Date());
    const t = setInterval(() => setNow(new Date()), 15_000);
    return () => clearInterval(t);
  }, []);
  if (!now) return null;
  return (
    <div className="hidden min-[1180px]:flex items-center gap-2.5 pl-4 ml-1 min-h-8 border-l-2 border-ob-rule">
      <span className="text-body-sm text-ob-ink-2">{ET_DAY.format(now)}</span>
      <span className="font-num text-body font-medium tabular-nums">{ET_TIME.format(now)}</span>
      <span className="text-meta font-bold text-ob-ink-3 tracking-[0.06em]" aria-label="Eastern time">
        ET
      </span>
    </div>
  );
}

function Wordmark() {
  return (
    <div className="flex items-center gap-2.5">
      <span aria-hidden="true" className="w-3.5 h-3.5 bg-ob-key rounded-ob" />
      <span className="text-18 font-extrabold tracking-[-0.01em]">Open Boat</span>
    </div>
  );
}

function SunlightButton({ tall }: { tall?: boolean }) {
  const { theme, setTheme } = useTheme();
  const on = theme === "sunlight";
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={() => setTheme(on ? "console" : "sunlight")}
      className={`flex items-center gap-2 ${tall ? "min-h-tap-dock px-3" : "min-h-11 px-3.5"} border-2 border-ob-rule rounded-ob text-body-sm font-bold ${
        on ? "bg-ob-key text-ob-key-ink" : "bg-transparent text-ob-ink hover:bg-ob-panel-2"
      }`}
    >
      <SunIcon size={tall ? 20 : 18} />
      Sunlight
    </button>
  );
}

function NavItems({
  pathname,
  reportsOwed,
  onNav,
  large,
}: {
  pathname: string;
  reportsOwed: number;
  onNav?: () => void;
  large?: boolean;
}) {
  return (
    <>
      {NAV.map(({ href, label }) => {
        const active = isActive(href, pathname);
        return (
          <Link
            key={href}
            href={href}
            onClick={onNav}
            aria-current={active ? "page" : undefined}
            className={`flex items-center rounded-ob px-3 text-ob-ink no-underline ${
              large ? "gap-3.5 min-h-tap-main text-18" : "gap-3 min-h-tap-dock text-body"
            } ${active ? "bg-ob-panel-2 font-extrabold" : "font-medium hover:bg-ob-panel-2"}`}
          >
            <Lamp tone={active ? "key" : "control"} shape={active ? "filled" : "hollow"} size={large ? 12 : 10} />
            <span className="flex-1">{label}</span>
            {href === "/admin/reports" && reportsOwed > 0 && (
              <span className="flex items-center gap-1.5 text-meta font-bold text-ob-caution-ink">
                <Lamp tone="caution" size={8} />
                {reportsOwed} owed
              </span>
            )}
          </Link>
        );
      })}
    </>
  );
}

function EasternTimeNote() {
  return (
    <>
      <div className="text-body-sm font-bold">Everything is Eastern time</div>
      <div className="text-meta text-ob-ink-2 mt-1 [text-wrap:pretty]">
        Type times the way you say them. We handle the clock change in the fall.
      </div>
    </>
  );
}

function Avatar({ name, size }: { name: string; size: "sm" | "md" }) {
  return (
    <span
      aria-hidden="true"
      className={`flex items-center justify-center flex-none bg-ob-panel-2 border border-ob-control rounded-ob font-extrabold ${
        size === "sm" ? "w-8 h-8 text-meta" : "w-10 h-10 text-body"
      }`}
    >
      {name.charAt(0).toUpperCase()}
    </span>
  );
}

/** Mobile menu: nav, Dock/Desk, the signed-in person + Sign out, the Eastern-time note. */
function MobileMenu({
  open,
  onClose,
  pathname,
  reportsOwed,
  name,
  onLogout,
}: {
  open: boolean;
  onClose: () => void;
  pathname: string;
  reportsOwed: number;
  name: string;
  onLogout: () => void;
}) {
  const { density, setDensity } = useDensity();
  const panelRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    const opener = document.activeElement as HTMLElement | null;
    panelRef.current?.querySelector<HTMLElement>("button, a")?.focus();
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onCloseRef.current();
      if (e.key !== "Tab" || !panelRef.current) return;
      const items = [...panelRef.current.querySelectorAll<HTMLElement>("button, a")];
      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = prevOverflow;
      if (opener && document.contains(opener)) opener.focus();
    };
  }, [open]);

  if (!open) return null;

  return (
    <div className="md:hidden print:hidden">
      <div className="fixed inset-0 z-40 bg-ob-scrim" onClick={onClose} aria-hidden="true" />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label="Menu"
        className="fixed inset-y-0 left-0 z-[41] w-[min(320px,86%)] flex flex-col overflow-y-auto bg-ob-panel border-r-2 border-ob-rule text-ob-ink"
      >
        <div className="flex items-center justify-between min-h-navbar pl-4 pr-2 border-b-2 border-ob-rule">
          <Wordmark />
          <button
            type="button"
            onClick={onClose}
            aria-label="Close menu"
            className="flex items-center justify-center w-12 h-12 text-ob-ink"
          >
            <CloseIcon size={24} />
          </button>
        </div>
        <nav aria-label="Admin" className="flex flex-col p-2">
          <NavItems pathname={pathname} reportsOwed={reportsOwed} onNav={onClose} large />
        </nav>
        <div className="flex flex-col gap-2.5 p-4 border-t-2 border-ob-rule">
          <div className="text-meta font-bold text-ob-ink-2">
            Screen size
          </div>
          <Segmented label="Screen size" options={DENSITY_OPTIONS} value={density} onChange={setDensity} size="dock" fill />
        </div>
        <div className="flex items-center gap-3 p-4 border-t-2 border-ob-rule">
          <Avatar name={name} size="md" />
          <span className="flex-1 text-body min-w-0 truncate">{name}</span>
          <button
            type="button"
            onClick={onLogout}
            className="min-h-tap-dock px-4 bg-transparent text-ob-ink border-2 border-ob-control rounded-ob text-body font-bold hover:bg-ob-panel-2"
          >
            Sign out
          </button>
        </div>
        <div className="p-4 border-t-2 border-ob-rule">
          <EasternTimeNote />
        </div>
      </div>
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
  const { density, setDensity } = useDensity();
  const [menuOpen, setMenuOpen] = useState(false);
  const reportsOwed = useReportsOwed(pathname);

  // A route change (from the menu or anywhere else) closes the menu.
  useEffect(() => setMenuOpen(false), [pathname]);

  return (
    <div className="min-h-screen flex flex-col bg-ob-bg text-ob-ink font-ui text-body antialiased print:bg-ob-panel print:min-h-0">
      <a
        href="#admin-main"
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-[70] focus:px-4 focus:py-3 focus:bg-ob-key focus:text-ob-key-ink focus:font-bold"
      >
        Skip to content
      </a>
      <header className="print:hidden sticky top-0 z-20 flex items-center gap-4 min-h-navbar px-4 whitespace-nowrap bg-ob-panel border-b-2 border-ob-rule">
        <button
          type="button"
          onClick={() => setMenuOpen(true)}
          aria-label="Open menu"
          aria-expanded={menuOpen}
          className="md:hidden flex items-center justify-center w-12 h-12 -ml-2 text-ob-ink"
        >
          <MenuIcon />
        </button>
        <Wordmark />
        <EtClock />
        <div className="flex-1" />
        <div className="hidden md:flex items-center gap-4">
          {/* Dock keeps every tap target at 48px, the top bar included; Desk uses the mockup's sizes. */}
          <Segmented label="Screen density" options={DENSITY_OPTIONS} value={density} onChange={setDensity} size={density} />
          <SunlightButton tall={density === "dock"} />
          <div className="flex items-center gap-2.5 pl-4 min-h-8 border-l-2 border-ob-rule">
            <Avatar name={me.name} size="sm" />
            <span className="text-body-sm text-ob-ink-2 max-w-40 truncate" title={me.name}>
              {me.name}
            </span>
            <button
              type="button"
              onClick={onLogout}
              className={`${density === "dock" ? "min-h-tap-dock" : "min-h-11"} px-3 text-body-sm font-bold text-ob-ink underline underline-offset-[3px] hover:text-ob-ink-2`}
            >
              Sign out
            </button>
          </div>
        </div>
        <div className="md:hidden -mr-1">
          <SunlightButton tall />
        </div>
      </header>

      <MobileMenu
        open={menuOpen}
        onClose={() => setMenuOpen(false)}
        pathname={pathname}
        reportsOwed={reportsOwed}
        name={me.name}
        onLogout={onLogout}
      />

      <div className="flex flex-1 min-h-0 print:block">
        <aside className="print:hidden hidden md:flex flex-none w-60 flex-col gap-0.5 px-3 py-4 bg-ob-panel border-r-2 border-ob-rule">
          <nav aria-label="Admin" className="flex flex-col gap-0.5">
            <NavItems pathname={pathname} reportsOwed={reportsOwed} />
          </nav>
          <div className="mt-5 pt-3.5 px-3 border-t-2 border-ob-rule">
            <EasternTimeNote />
          </div>
        </aside>
        <main
          id="admin-main"
          tabIndex={-1}
          className="flex-1 min-w-0 flex flex-col gap-6 pt-4 px-3 pb-12 md:pt-7 md:px-8 md:pb-16 focus:outline-none print:p-0"
        >
          {children}
          <div className="md:hidden print:hidden px-1 text-meta text-ob-ink-3">Everything is Eastern time.</div>
        </main>
      </div>
    </div>
  );
}
