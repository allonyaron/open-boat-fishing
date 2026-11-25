"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

const POLL_INTERVAL_MS = 3000;
// Stripe has the money and the webhook issues the passes in a second or two.
const PAID_POLL_INTERVAL_MS = 1500;

/** `paid`: the payment succeeded and the booking is waiting for its webhook. */
export function ProcessingScreen({ paid = false }: { paid?: boolean }) {
  const router = useRouter();
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const id = setInterval(() => {
      setTick((t) => t + 1);
      router.refresh();
    }, paid ? PAID_POLL_INTERVAL_MS : POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [router, paid]);

  const progressPct = 30 + (tick % 3) * 30;

  return (
    <div
      className="flex flex-col items-center justify-center gap-4 text-center font-archivo"
      style={{ minHeight: 620, padding: "40px 24px" }}
    >
      <div className="font-plex-mono font-semibold" style={{ fontSize: 12, letterSpacing: ".18em", color: "#5b6f79" }}>
        PAYMENT PROCESSING
      </div>
      <h1
        className="font-archivo font-bold uppercase leading-none"
        style={{ fontSize: 34, letterSpacing: "-.02em", color: "#16354a" }}
      >
        ALMOST THERE.
      </h1>
      <div className="font-archivo" style={{ fontSize: 17, lineHeight: 1.5, color: "#41565f", maxWidth: "30ch" }}>
        {paid
          ? "Payment received. We're issuing your boarding passes — this screen moves on by itself."
          : "Your bank is confirming the charge. This screen moves on by itself — no need to touch anything."}
      </div>
      <div style={{ width: 220, height: 6, background: "#dde4e6", overflow: "hidden" }}>
        <div
          style={{
            height: "100%",
            background: "#c94510",
            width: `${progressPct}%`,
            transition: "width .9s linear",
          }}
        />
      </div>
      <button
        type="button"
        onClick={() => router.refresh()}
        className="font-plex-mono font-semibold"
        style={{ fontSize: 12, letterSpacing: ".1em", background: "none", border: "1px solid #9aa8ae", color: "#41565f", padding: "16px 22px", cursor: "pointer" }}
      >
        TAKING TOO LONG? CHECK AGAIN
      </button>
    </div>
  );
}
