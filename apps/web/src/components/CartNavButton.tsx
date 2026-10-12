"use client";

import Link from "next/link";
import { totalSeats } from "@openboat/utils";
import { useCartStore } from "@/lib/cart/store";

export function CartNavButton() {
  const count = totalSeats(useCartStore().lines);

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
