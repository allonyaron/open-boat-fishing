"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { EnrichedCartItem } from "@/components/BookingCalendar";

function getCartCount(): number {
  try {
    const raw = localStorage.getItem("openboat_cart");
    if (!raw) return 0;
    const items: EnrichedCartItem[] = JSON.parse(raw);
    return items.reduce((sum, item) => sum + item.tickets.reduce((s, t) => s + t.quantity, 0), 0);
  } catch {
    return 0;
  }
}

export function CartNavButton() {
  const [count, setCount] = useState(0);

  useEffect(() => {
    setCount(getCartCount());
    const onStorage = () => setCount(getCartCount());
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const label = count > 0 ? `CART · ${count}` : "BOOK A SEAT";

  return (
    <Link
      href={count > 0 ? "/cart" : "/book"}
      className="font-plex-mono font-semibold tracking-[.1em] text-white bg-orange hover:bg-orange-press transition-colors"
      style={{ fontSize: 12, padding: "11px 16px", textDecoration: "none" }}
    >
      {label}
    </Link>
  );
}
