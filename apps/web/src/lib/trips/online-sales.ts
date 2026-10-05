import { sql, type SQL, type AnyColumn } from "drizzle-orm";

// Online sales for a trip close `cutoff` minutes before startTime, where cutoff
// is the trip's own override or else the operator's default:
//
//   open  ⇔  now < startTime − cutoff
//
// Everything compares the startTime instant (timestamptz), never departureDate,
// so there's no ET/UTC date math. The JS and SQL forms below must stay the same
// inequality: the booking route checks one, the trip list filters on the other.

type CutoffTrip = { startTime: Date; onlineCutoffMinutes: number | null };

export function effectiveCutoffMinutes(trip: CutoffTrip, operatorDefaultMinutes: number): number {
  return trip.onlineCutoffMinutes ?? operatorDefaultMinutes;
}

export function onlineSalesCloseAt(trip: CutoffTrip, operatorDefaultMinutes: number): Date {
  return new Date(
    trip.startTime.getTime() - effectiveCutoffMinutes(trip, operatorDefaultMinutes) * 60_000,
  );
}

export function isOnlineSalesOpen(
  trip: CutoffTrip,
  operatorDefaultMinutes: number,
  now: Date = new Date(),
): boolean {
  return now.getTime() < onlineSalesCloseAt(trip, operatorDefaultMinutes).getTime();
}

/**
 * SQL form of isOnlineSalesOpen for trip list queries. Takes the trips columns
 * from the query (so it works inside a relational `where` callback) and reads
 * the operator default through a scalar subquery, so callers need only the
 * trips row.
 */
export function onlineSalesOpenSql(
  t: { startTime: AnyColumn; onlineCutoffMinutes: AnyColumn; operatorId: AnyColumn },
  now: Date = new Date(),
): SQL {
  return sql`${t.startTime} - coalesce(
    ${t.onlineCutoffMinutes},
    (select o.online_cutoff_minutes from operators o where o.id = ${t.operatorId})
  ) * interval '1 minute' > ${now.toISOString()}::timestamptz`;
}
