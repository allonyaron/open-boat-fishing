"use client";

import { useEffect, useState } from "react";

/**
 * The current time, re-read every `intervalMs` so clock-based lights
 * (Boarding now, Departed) move on their own without a reload.
 */
export function useNow(intervalMs = 30_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}

const WHOLE = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
const CENTS = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2 });

/** Readout money: "$6,385", or "$1,487.50" when there are cents. */
export function fmtMoney(cents: number): string {
  return cents % 100 === 0 ? WHOLE.format(cents / 100) : CENTS.format(cents / 100);
}

const TIME_PARTS = new Intl.DateTimeFormat("en-US", {
  hour: "numeric",
  minute: "2-digit",
  hour12: true,
  timeZone: "America/New_York",
});

/** "7:00" and "AM" separately, in Eastern time — the big mono time plus its small suffix. */
export function timeAndPeriodET(iso: string): { time: string; period: string } {
  const parts = TIME_PARTS.formatToParts(new Date(iso));
  const hour = parts.find((p) => p.type === "hour")?.value ?? "";
  const minute = parts.find((p) => p.type === "minute")?.value ?? "00";
  const period = (parts.find((p) => p.type === "dayPeriod")?.value ?? "").toUpperCase();
  return { time: `${hour}:${minute}`, period };
}
