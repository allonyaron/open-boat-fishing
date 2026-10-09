"use client";

import { useEffect } from "react";
import { clearHold, loadHold } from "@/lib/checkout/stored-hold";

// Mounted on the confirmed-booking view. When it shows the booking this tab
// was paying for, the purchase is done: drop the cart and the saved hold. Any
// other confirmation (an old link from an email) leaves a new cart alone.
export function ClearPendingPayment({ confirmationCode }: { confirmationCode: string }) {
  useEffect(() => {
    // Written by checkouts before 4b; nothing sets it now.
    localStorage.removeItem("openboat_pending_payment");
    if (loadHold()?.confirmationCode !== confirmationCode) return;
    clearHold();
    localStorage.removeItem("openboat_cart");
  }, [confirmationCode]);
  return null;
}
