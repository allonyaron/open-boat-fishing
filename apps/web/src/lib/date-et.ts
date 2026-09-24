const ET_DATE_FORMATTER = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/New_York",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/**
 * Today's date as YYYY-MM-DD in America/New_York, not the server's local/UTC
 * date. Matters most in the 8pm-midnight ET window, where UTC has already
 * rolled to tomorrow — using `new Date().toISOString().slice(0,10)` there
 * would show a captain the wrong day's trips.
 */
export function todayET(): string {
  // en-CA formats as YYYY-MM-DD directly.
  return ET_DATE_FORMATTER.format(new Date());
}

export function addDaysToDateString(date: string, days: number): string {
  const d = new Date(date + "T12:00:00Z"); // noon UTC avoids DST-edge date-rollover bugs
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * UTC instant for a wall-clock time on a given YYYY-MM-DD date, interpreted
 * in America/New_York — "7:00 PM on Sept 23" becomes the correct UTC instant
 * for that ET moment. Resolves the actual EST/EDT offset via Intl (never a
 * hardcoded -05:00), so this stays correct across the DST transition.
 *
 * Every admin-facing time input (schedule departure/return times, one-off
 * departures) is typed as plain ET wall-clock per the "Everything is Eastern
 * time" product invariant — no UTC exposed anywhere in that UI. This is the
 * one place that conversion happens; nothing should build a trip's
 * startTime/endTime with a literal "Z" suffix on the raw typed digits, since
 * that would silently store the wrong instant (off by the ET/UTC offset).
 */
export function etWallClockToUTC(dateStr: string, timeStr: string): Date {
  const noonGuess = new Date(dateStr + "T12:00:00Z");
  const offsetPart = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    timeZoneName: "shortOffset",
  })
    .formatToParts(noonGuess)
    .find((p) => p.type === "timeZoneName")?.value;
  const match = /GMT([+-]\d+)/.exec(offsetPart ?? "");
  const offsetHours = match ? parseInt(match[1], 10) : -5;
  const sign = offsetHours < 0 ? "-" : "+";
  const hh = String(Math.abs(offsetHours)).padStart(2, "0");
  return new Date(`${dateStr}T${timeStr}${sign}${hh}:00`);
}

/** UTC instant for midnight America/New_York on the given YYYY-MM-DD date. */
export function etMidnightUTC(dateStr: string): Date {
  return etWallClockToUTC(dateStr, "00:00:00");
}
