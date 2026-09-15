"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

const POLL_INTERVAL_MS = 3000;

export function ProcessingScreen() {
  const router = useRouter();
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const id = setInterval(() => {
      setTick((t) => t + 1);
      router.refresh();
    }, POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [router]);

  const progressPct = 30 + (tick % 3) * 30;

  return (
    <div
      className="flex flex-col items-center justify-center gap-4 px-6 py-[60px] text-center font-archivo"
      style={{ minHeight: "72vh" }}
    >
      <div className="font-plex-mono text-[12px] font-semibold tracking-[.18em]" style={{ color: "#5b6f79" }}>
        PAYMENT PROCESSING
      </div>
      <h1
        className="font-bold uppercase leading-none"
        style={{ fontSize: "clamp(28px, 4vw, 40px)", letterSpacing: "-.02em", color: "#0d1c26" }}
      >
        Almost there.
      </h1>
      <div className="text-[17px] leading-normal" style={{ color: "#41565f", maxWidth: "44ch" }}>
        Your bank is confirming the charge. This screen moves on by itself — no need to touch
        anything.
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
        className="font-plex-mono text-[12px] font-semibold tracking-[.1em]"
        style={{ background: "none", border: "1px solid #9aa8ae", color: "#41565f", padding: "15px 22px", cursor: "pointer" }}
      >
        TAKING TOO LONG? CHECK AGAIN
      </button>
    </div>
  );
}
