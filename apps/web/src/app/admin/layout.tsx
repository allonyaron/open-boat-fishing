"use client";

import "./ob-tokens.css";
import { useEffect, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import { DensityProvider, ThemeProvider, ToastProvider, Chrome } from "@/components/admin/merchant";

type Me = { staffId: string; name: string; role: string } | null;

// Runs as the server-rendered page is parsed, before anything paints, so a
// Sunlight device never flashes the dark Console theme while React loads.
// ThemeProvider takes over once hydrated (and removes the attribute when the admin unmounts).
const THEME_BOOT = `try{var t=localStorage.getItem("openboat_admin_theme")==="sunlight"?"sunlight":"console";var d=document.documentElement;d.dataset.obTheme=t;d.style.colorScheme=t==="sunlight"?"light":"dark"}catch(e){}`;

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider>
      <script dangerouslySetInnerHTML={{ __html: THEME_BOOT }} suppressHydrationWarning />
      <DensityProvider>
        <AdminShell>{children}</AdminShell>
      </DensityProvider>
    </ThemeProvider>
  );
}

function AdminShell({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [me, setMe] = useState<Me | undefined>(undefined);

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

  async function logout() {
    await fetch("/api/admin/auth/logout", { method: "POST" });
    router.replace("/admin/login");
  }

  if (pathname === "/admin/login") {
    return <>{children}</>;
  }

  if (me === undefined) {
    return (
      <div className="min-h-screen bg-ob-bg font-ui flex items-center justify-center">
        <div role="status" className="text-body-sm text-ob-ink-3">
          Loading…
        </div>
      </div>
    );
  }

  if (!me) return null; // redirecting to /admin/login

  return (
    <ToastProvider>
      <Chrome me={me} pathname={pathname} onLogout={logout}>
        {children}
      </Chrome>
    </ToastProvider>
  );
}
