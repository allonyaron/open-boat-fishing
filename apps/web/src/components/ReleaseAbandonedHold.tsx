"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { clearHold, loadHold, releaseHold } from "@/lib/checkout/stored-hold";

// Checkout keeps its held booking in sessionStorage. Reaching any other page
// in the same tab, by Back, a nav link or the home page, means the customer
// left checkout without paying, so give the seats back now rather than when
// the hold expires (P2-3). Checkout resumes or releases the hold itself, and
// /booking/* is where Stripe returns after a payment.
export function ReleaseAbandonedHold() {
  const pathname = usePathname();
  useEffect(() => {
    function release() {
      if (pathname === "/checkout" || pathname.startsWith("/booking/")) return;
      const hold = loadHold();
      if (!hold) return;
      // Kept on failure, so the next page (or checkout's replaces) tries again.
      void releaseHold(hold).then((result) => {
        if (result !== "failed") clearHold();
      });
    }
    release();
    // Back to a page restored from the back-forward cache (Safari keeps more
    // pages there) runs no effects, so check again when it is shown.
    function onPageShow(e: PageTransitionEvent) {
      if (e.persisted) release();
    }
    window.addEventListener("pageshow", onPageShow);
    return () => window.removeEventListener("pageshow", onPageShow);
  }, [pathname]);
  return null;
}
