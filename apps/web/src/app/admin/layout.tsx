"use client";

import { useEffect, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import { DensityProvider, ToastProvider, Chrome } from "@/components/admin/merchant";

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

  if (pathname === "/admin/login") {
    return <>{children}</>;
  }

  if (me === undefined) {
    return (
      <div className="min-h-screen bg-merchant-page flex items-center justify-center">
        <div className="text-merchant-faint text-13">Loading…</div>
      </div>
    );
  }

  if (!me) return null; // redirecting to /admin/login

  return (
    <DensityProvider>
      <ToastProvider>
        <Chrome me={me} pathname={pathname} onLogout={logout}>
          {children}
        </Chrome>
      </ToastProvider>
    </DensityProvider>
  );
}
