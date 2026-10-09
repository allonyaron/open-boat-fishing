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
    if (pathname === "/checkout" || pathname.startsWith("/booking/")) return;
    const hold = loadHold();
    if (!hold) return;
    clearHold();
    void releaseHold(hold);
  }, [pathname]);
  return null;
}
