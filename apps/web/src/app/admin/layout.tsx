"use client";

import { useEffect, useState } from "react";
import { useRouter, usePathname } from "next/navigation";

type Me = { staffId: string; name: string; role: string } | null;

export default function AdminLayout({ children }: { children: React.ReactNode }) {
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

  if (me === undefined) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-gray-400 text-sm">Loading…</div>
      </div>
    );
  }

  if (pathname === "/admin/login") {
    return <>{children}</>;
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b border-gray-200 px-6 py-3 flex items-center justify-between">
        <div className="flex items-center gap-6">
          <span className="font-semibold text-gray-900">Admin</span>
          <nav className="flex gap-4 text-sm">
            <a href="/admin/trips" className="text-gray-600 hover:text-gray-900">
              Trips
            </a>
            <a href="/admin/revenue" className="text-gray-600 hover:text-gray-900">
              Revenue
            </a>
            <a href="/admin/settings" className="text-gray-600 hover:text-gray-900">
              Settings
            </a>
          </nav>
        </div>
        {me && (
          <div className="flex items-center gap-3 text-sm text-gray-500">
            <span>{me.name}</span>
            <button
              onClick={logout}
              className="text-gray-400 hover:text-gray-700 transition-colors"
            >
              Sign out
            </button>
          </div>
        )}
      </header>
      <main className="p-6">{children}</main>
    </div>
  );
}
