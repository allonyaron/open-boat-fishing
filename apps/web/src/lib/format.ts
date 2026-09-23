export function fmtTimeET(iso: string | Date): string {
  return new Date(iso).toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: "America/New_York",
  });
}

/** Compact form for summary lines — "7a", "1:30p" — never "7:00 AM". */
export function fmtTimeCompactET(iso: string | Date): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZone: "America/New_York",
  }).formatToParts(new Date(iso));
  const hour = parts.find((p) => p.type === "hour")?.value ?? "";
  const minute = parts.find((p) => p.type === "minute")?.value ?? "00";
  const suffix = (parts.find((p) => p.type === "dayPeriod")?.value ?? "").toLowerCase().charAt(0);
  return minute === "00" ? `${hour}${suffix}` : `${hour}:${minute}${suffix}`;
}

/** "Tomorrow" for todayStr+1, else "Sat, Sep 26". Both args are YYYY-MM-DD. */
export function fmtDayLabelET(dateStr: string, todayStr: string): string {
  const [ty, tm, td] = todayStr.split("-").map(Number);
  const today = new Date(Date.UTC(ty, tm - 1, td));
  const [y, m, d] = dateStr.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  const diffDays = Math.round((date.getTime() - today.getTime()) / 86_400_000);
  if (diffDays === 1) return "Tomorrow";
  return date.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
}
