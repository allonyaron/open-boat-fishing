"use client";

import { useEffect, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import Link from "next/link";

type Me = { staffId: string; name: string; role: string } | null;

function DashboardIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="7" height="7" rx="1" />
      <rect x="14" y="3" width="7" height="7" rx="1" />
      <rect x="3" y="14" width="7" height="7" rx="1" />
      <rect x="14" y="14" width="7" height="7" rx="1" />
    </svg>
  );
}

function TripsIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 17l2-8h14l2 8" />
      <path d="M5 17a7 7 0 0 0 14 0" />
      <path d="M12 9V4" />
      <path d="M9 4h6" />
    </svg>
  );
}

function RevenueIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <line x1="12" y1="1" x2="12" y2="23" />
      <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
    </svg>
  );
}

function SettingsIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  );
}

function MenuIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="3" y1="6" x2="21" y2="6" />
      <line x1="3" y1="12" x2="21" y2="12" />
      <line x1="3" y1="18" x2="21" y2="18" />
    </svg>
  );
}

function XIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}

const NAV = [
  { href: "/admin", label: "Dashboard", Icon: DashboardIcon },
  { href: "/admin/trips", label: "Trips", Icon: TripsIcon },
  { href: "/admin/revenue", label: "Revenue", Icon: RevenueIcon },
  { href: "/admin/settings", label: "Settings", Icon: SettingsIcon },
];

function SidebarContents({ me, pathname, onNav, onLogout }: {
  me: NonNullable<Me>;
  pathname: string;
  onNav: () => void;
  onLogout: () => void;
}) {
  return (
    <>
      {/* Brand */}
      <div className="px-6 py-5 border-b border-white/10">
        <div className="flex items-center gap-2">
          <span className="text-gold text-lg">⚓</span>
          <span className="text-white font-semibold text-sm tracking-wide">Open Boat</span>
        </div>
        <div className="text-white/30 text-xs mt-0.5">Captain's Dashboard</div>
      </div>

      {/* Nav */}
      <nav className="flex-1 py-4 px-3 space-y-0.5">
        {NAV.map(({ href, label, Icon }) => {
          const active = href === "/admin" ? pathname === "/admin" : pathname.startsWith(href);
          return (
            <Link
              key={href}
              href={href}
              onClick={onNav}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                active
                  ? "bg-navy-light text-gold"
                  : "text-white/60 hover:text-white hover:bg-white/5"
              }`}
            >
              <span className={active ? "text-gold" : "text-white/40"}>
                <Icon />
              </span>
              {label}
            </Link>
          );
        })}
      </nav>

      {/* User */}
      <div className="px-4 py-4 border-t border-white/10">
        <div className="flex items-center gap-2 mb-2">
          <div className="w-7 h-7 rounded-full bg-navy-light flex items-center justify-center text-gold text-xs font-bold flex-shrink-0">
            {me.name.charAt(0).toUpperCase()}
          </div>
          <div className="min-w-0">
            <div className="text-white text-xs font-medium truncate">{me.name}</div>
            <div className="text-white/40 text-xs capitalize">{me.role}</div>
          </div>
        </div>
        <button
          onClick={onLogout}
          className="text-white/30 hover:text-white/60 text-xs transition-colors"
        >
          Sign out
        </button>
      </div>
    </>
  );
}

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [me, setMe] = useState<Me | undefined>(undefined);
  const [drawerOpen, setDrawerOpen] = useState(false);

  useEffect(() => {
    fetch("/api/admin/auth/me")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        setMe(data);
        if (!data && pathname !== "/admin/login") {
          router.replace("/admin/login");
        }
      });
  }, [pathname, router]);

  // Close drawer on route change
  useEffect(() => { setDrawerOpen(false); }, [pathname]);

  async function logout() {
    await fetch("/api/admin/auth/logout", { method: "POST" });
    router.replace("/admin/login");
  }

  if (me === undefined) {
    return (
      <div className="min-h-screen bg-surface flex items-center justify-center">
        <div className="text-faint text-sm">Loading…</div>
      </div>
    );
  }

  if (pathname === "/admin/login") {
    return <>{children}</>;
  }

  return (
    <div className="flex min-h-screen bg-surface">
      {/* Desktop sidebar — hidden on mobile */}
      <aside className="hidden md:flex w-56 bg-navy flex-shrink-0 flex-col shadow-sidebar sticky top-0 h-screen overflow-y-auto">
        {me && (
          <SidebarContents
            me={me}
            pathname={pathname}
            onNav={() => {}}
            onLogout={logout}
          />
        )}
      </aside>

      {/* Mobile drawer overlay */}
      {drawerOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/50 md:hidden"
          onClick={() => setDrawerOpen(false)}
        />
      )}

      {/* Mobile drawer */}
      <aside
        className={`fixed top-0 left-0 z-50 h-full w-64 bg-navy flex flex-col shadow-sidebar transition-transform duration-200 md:hidden ${
          drawerOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-white/10">
          <div className="flex items-center gap-2">
            <span className="text-gold text-lg">⚓</span>
            <span className="text-white font-semibold text-sm tracking-wide">Open Boat</span>
          </div>
          <button
            onClick={() => setDrawerOpen(false)}
            className="text-white/50 hover:text-white transition-colors p-1"
            aria-label="Close menu"
          >
            <XIcon />
          </button>
        </div>
        {me && (
          <>
            <nav className="flex-1 py-4 px-3 space-y-0.5 overflow-y-auto">
              {NAV.map(({ href, label, Icon }) => {
                const active = href === "/admin" ? pathname === "/admin" : pathname.startsWith(href);
                return (
                  <Link
                    key={href}
                    href={href}
                    onClick={() => setDrawerOpen(false)}
                    className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                      active
                        ? "bg-navy-light text-gold"
                        : "text-white/60 hover:text-white hover:bg-white/5"
                    }`}
                  >
                    <span className={active ? "text-gold" : "text-white/40"}>
                      <Icon />
                    </span>
                    {label}
                  </Link>
                );
              })}
            </nav>
            <div className="px-4 py-4 border-t border-white/10">
              <div className="flex items-center gap-2 mb-2">
                <div className="w-7 h-7 rounded-full bg-navy-light flex items-center justify-center text-gold text-xs font-bold flex-shrink-0">
                  {me.name.charAt(0).toUpperCase()}
                </div>
                <div className="min-w-0">
                  <div className="text-white text-xs font-medium truncate">{me.name}</div>
                  <div className="text-white/40 text-xs capitalize">{me.role}</div>
                </div>
              </div>
              <button
                onClick={logout}
                className="text-white/30 hover:text-white/60 text-xs transition-colors"
              >
                Sign out
              </button>
            </div>
          </>
        )}
      </aside>

      {/* Content area */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Mobile top bar */}
        <header className="md:hidden bg-navy px-4 py-3 flex items-center gap-3 flex-shrink-0 shadow-sidebar">
          <button
            onClick={() => setDrawerOpen(true)}
            className="text-white/70 hover:text-white transition-colors p-1 -ml-1"
            aria-label="Open menu"
          >
            <MenuIcon />
          </button>
          <div className="flex items-center gap-2">
            <span className="text-gold">⚓</span>
            <span className="text-white font-semibold text-sm tracking-wide">Open Boat</span>
          </div>
        </header>

        <main className="flex-1 overflow-auto p-4 md:p-6">{children}</main>
      </div>
    </div>
  );
}
