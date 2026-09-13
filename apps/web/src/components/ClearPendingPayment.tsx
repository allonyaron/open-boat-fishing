"use client";

import { useEffect } from "react";

export function ClearPendingPayment() {
  useEffect(() => {
    localStorage.removeItem("openboat_pending_payment");
  }, []);
  return null;
}
