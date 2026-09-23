export type DayOfWeek = "mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun";

const DOW_TO_JS: Record<DayOfWeek, number> = {
  sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6,
};

export const VALID_DAYS: DayOfWeek[] = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];

export function datesInRange(start: string, end: string, days: DayOfWeek[]): string[] {
  const dayNums = days.map((d) => DOW_TO_JS[d]);
  const result: string[] = [];
  const cur = new Date(start + "T12:00:00Z");
  const endDate = new Date(end + "T12:00:00Z");
  while (cur <= endDate) {
    if (dayNums.includes(cur.getUTCDay())) {
      result.push(cur.toISOString().slice(0, 10));
    }
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return result;
}

export function parseTime(t: string): { hours: number; minutes: number } | null {
  const m = /^(\d{1,2}):(\d{2})(?::\d{2})?$/.exec(t);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return { hours: h, minutes: min };
}

export function toTimeString(h: number, m: number) {
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:00`;
}

/** True when the return time is earlier in the clock than departure — an overnight trip. */
export function isOvernight(
  dep: { hours: number; minutes: number },
  ret: { hours: number; minutes: number },
) {
  return ret.hours < dep.hours || (ret.hours === dep.hours && ret.minutes < dep.minutes);
}

/** departureDate + HH:MM:SS strings -> the UTC Date the trip returns, rolling to the next day if overnight. */
export function tripEndDate(departureDate: string, returnTime: string, overnight: boolean): string {
  return overnight
    ? new Date(new Date(departureDate + "T00:00:00Z").getTime() + 86_400_000).toISOString().slice(0, 10)
    : departureDate;
}
