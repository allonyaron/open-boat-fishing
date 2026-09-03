"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";

type TripRow = {
  id: string;
  departureDate: string;
  startTime: string;
  endTime: string;
  boardingTime: string | null;
  capacity: number;
  seatsRemaining: number;
  status: "scheduled" | "pending_settlement" | "sailed" | "cancelled";
  sailedAt: string | null;
  cancelledAt: string | null;
  cancellationReason: string | null;
  ticketsSold: number;
  vessel: { id: string; name: string; color: string };
  product: { id: string; displayName: string; category: string };
};

type CancelModal = { trip: TripRow; reason: string; loading: boolean; error: string };

type Range = "today" | "week" | "month" | "all";

const RANGES: { label: string; value: Range }[] = [
  { label: "Today", value: "today" },
  { label: "7 days", value: "week" },
  { label: "30 days", value: "month" },
  { label: "All", value: "all" },
];

const STATUS_LABEL: Record<TripRow["status"], string> = {
  scheduled: "Scheduled",
  pending_settlement: "Pending",
  sailed: "Sailed",
  cancelled: "Cancelled",
};

const STATUS_COLOR: Record<TripRow["status"], string> = {
  scheduled: "bg-blue-100 text-blue-700",
  pending_settlement: "bg-yellow-100 text-yellow-700",
  sailed: "bg-green-100 text-green-700",
  cancelled: "bg-red-100 text-red-700",
};

function fmt(iso: string) {
  return new Date(iso).toLocaleString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

function fmtDate(date: string) {
  const [y, m, d] = date.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today);
  tomorrow.setDate(today.getDate() + 1);

  if (dt.getTime() === today.getTime()) return "Today";
  if (dt.getTime() === tomorrow.getTime()) return "Tomorrow";
  return dt.toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" });
}

function cutoffDate(range: Range): string | null {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  if (range === "today") return d.toISOString().slice(0, 10);
  if (range === "week") {
    d.setDate(d.getDate() + 6);
    return d.toISOString().slice(0, 10);
  }
  if (range === "month") {
    d.setDate(d.getDate() + 29);
    return d.toISOString().slice(0, 10);
  }
  return null;
}

export default function AdminTripsPage() {
  const [trips, setTrips] = useState<TripRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState<CancelModal | null>(null);
  const [range, setRange] = useState<Range>("week");

  const load = useCallback(async () => {
    setLoading(true);
    const res = await fetch("/api/admin/trips");
    if (res.ok) setTrips(await res.json());
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function cancelTrip() {
    if (!modal) return;
    setModal((m) => m && { ...m, loading: true, error: "" });
    const res = await fetch(`/api/admin/trips/${modal.trip.id}/cancel`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reason: modal.reason || undefined }),
    });
    const data = await res.json();
    if (res.ok) {
      setModal(null);
      await load();
    } else {
      setModal((m) => m && { ...m, loading: false, error: data.error ?? "Cancellation failed" });
    }
  }

  const today = new Date().toISOString().slice(0, 10);
  const cutoff = cutoffDate(range);

  // Apply date range filter client-side (data already loaded)
  const filtered = trips.filter((t) => {
    if (t.departureDate < today) return false;
    if (cutoff && t.departureDate > cutoff) return false;
    return true;
  });

  // Group filtered trips by date
  const grouped: Record<string, TripRow[]> = {};
  for (const trip of filtered) {
    if (!grouped[trip.departureDate]) grouped[trip.departureDate] = [];
    grouped[trip.departureDate].push(trip);
  }

  // Today's stats (always from full dataset, not filtered view)
  const todayTrips = trips.filter((t) => t.departureDate === today && t.status !== "cancelled");
  const todaySold = todayTrips.reduce((sum, t) => sum + Number(t.ticketsSold), 0);
  const todayCapacity = todayTrips.reduce((sum, t) => sum + t.capacity, 0);
  const todayOpen = todayTrips.reduce((sum, t) => sum + t.seatsRemaining, 0);

  return (
    <>
      <div className="max-w-5xl mx-auto">
        {/* Page header */}
        <div className="flex items-center justify-between mb-5">
          <div>
            <h1 className="text-xl font-semibold text-ink">Trips</h1>
            <p className="text-sm text-muted mt-0.5">Upcoming departures across all vessels</p>
          </div>
          <button
            onClick={load}
            className="text-sm text-muted hover:text-ink border border-hairline bg-white rounded-lg px-3 py-1.5 transition-colors hover:border-gray-300"
          >
            Refresh
          </button>
        </div>

        {/* Today at a glance */}
        {!loading && todayTrips.length > 0 && (
          <div className="grid grid-cols-3 gap-3 mb-6">
            <StatCard
              label="Today's Trips"
              value={String(todayTrips.length)}
              sub={todayTrips.length === 1 ? "departure" : "departures"}
              accent="navy"
            />
            <StatCard
              label="Tickets Sold"
              value={`${todaySold} / ${todayCapacity}`}
              sub={todayCapacity > 0 ? `${Math.round((todaySold / todayCapacity) * 100)}% booked` : "—"}
              accent="gold"
            />
            <StatCard
              label="Open Seats"
              value={String(todayOpen)}
              sub={todayOpen === 0 ? "sold out" : "available now"}
              accent={todayOpen === 0 ? "green" : "default"}
            />
          </div>
        )}

        {/* Date range filter */}
        <div className="flex items-center gap-2 mb-4">
          <span className="text-xs font-medium text-muted uppercase tracking-label">Showing</span>
          <div className="flex gap-1 bg-white border border-hairline rounded-lg p-1">
            {RANGES.map((r) => (
              <button
                key={r.value}
                onClick={() => setRange(r.value)}
                className={`px-3 py-1 rounded-md text-sm font-medium transition-colors ${
                  range === r.value
                    ? "bg-navy text-white shadow-sm"
                    : "text-muted hover:text-ink"
                }`}
              >
                {r.label}
              </button>
            ))}
          </div>
          {!loading && (
            <span className="text-xs text-faint ml-1">
              {Object.keys(grouped).length} day{Object.keys(grouped).length !== 1 ? "s" : ""},&nbsp;
              {filtered.length} trip{filtered.length !== 1 ? "s" : ""}
            </span>
          )}
        </div>

        {/* Trip list */}
        {loading ? (
          <div className="text-center text-muted py-16 text-sm">Loading…</div>
        ) : filtered.length === 0 ? (
          <div className="text-center text-muted py-16 text-sm">No trips in this range</div>
        ) : (
          <div className="space-y-5">
            {Object.entries(grouped).map(([date, dayTrips]) => (
              <section key={date}>
                <h2 className="text-xs font-semibold text-muted uppercase tracking-label mb-2 px-1">
                  {fmtDate(date)}
                </h2>
                <div className="bg-white rounded-xl border border-hairline divide-y divide-hairline">
                  {dayTrips.map((trip) => {
                    const sold = Number(trip.ticketsSold);
                    const pct = trip.capacity > 0 ? Math.round((sold / trip.capacity) * 100) : 0;
                    const canCancel = trip.status !== "cancelled";

                    return (
                      <div key={trip.id} className="flex items-center gap-4 px-5 py-4">
                        {/* Vessel color swatch */}
                        <div
                          className="w-1.5 h-10 rounded-full flex-shrink-0"
                          style={{ backgroundColor: trip.vessel.color }}
                        />

                        {/* Main info */}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-semibold text-sm text-ink">{trip.vessel.name}</span>
                            <span className="text-hairline">·</span>
                            <span className="text-sm text-muted">{trip.product.displayName}</span>
                            <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_COLOR[trip.status]}`}>
                              {STATUS_LABEL[trip.status]}
                            </span>
                          </div>
                          <div className="text-xs text-muted mt-0.5">
                            {fmt(trip.startTime)} →{" "}
                            {new Date(trip.endTime).toLocaleTimeString("en-US", {
                              hour: "numeric",
                              minute: "2-digit",
                              hour12: true,
                            })}
                            {trip.cancellationReason && (
                              <span className="ml-2 text-warning">· {trip.cancellationReason}</span>
                            )}
                          </div>
                        </div>

                        {/* Seats */}
                        <div className="text-right flex-shrink-0 min-w-[88px]">
                          <div className="text-sm font-semibold text-ink">{sold} / {trip.capacity}</div>
                          <div className="text-xs text-muted">{pct}% booked</div>
                          <div className="mt-1.5 h-1.5 w-20 bg-fill rounded-full overflow-hidden ml-auto">
                            <div
                              className="h-full rounded-full transition-all"
                              style={{
                                width: `${pct}%`,
                                backgroundColor: pct >= 90 ? "#c65b4e" : pct >= 60 ? "#c99a3f" : "#0E7C7B",
                              }}
                            />
                          </div>
                        </div>

                        {/* Actions */}
                        <div className="flex-shrink-0 flex items-center gap-1">
                          <Link
                            href={`/admin/trips/${trip.id}`}
                            className="text-sm font-medium text-navy hover:text-navy-light px-3 py-1.5 rounded-lg hover:bg-navy-tint transition-colors"
                          >
                            Manifest
                          </Link>
                          {canCancel ? (
                            <button
                              onClick={() => setModal({ trip, reason: "", loading: false, error: "" })}
                              className="text-sm font-medium text-warning hover:text-red-700 px-3 py-1.5 rounded-lg hover:bg-warning-bg transition-colors"
                            >
                              Cancel
                            </button>
                          ) : (
                            <span className="w-[72px]" />
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </section>
            ))}
          </div>
        )}
      </div>

      {/* Cancellation modal backdrop */}
      {modal && (
        <div className="fixed inset-0 z-50 bg-black/40" aria-hidden="true" />
      )}
      {modal && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="cancel-trip-title"
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
        >
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6">
            <h2 id="cancel-trip-title" className="text-base font-semibold text-ink mb-1">Cancel this trip?</h2>
            <p className="text-sm text-muted mb-4">
              <strong className="text-ink">{modal.trip.vessel.name}</strong> · {modal.trip.product.displayName}
              <br />
              {fmt(modal.trip.startTime)}
              <br />
              <span className="text-warning font-medium">
                {Number(modal.trip.ticketsSold)} tickets will be refunded automatically.
              </span>
            </p>

            <div className="mb-4">
              <label htmlFor="cancel-reason" className="block text-sm font-medium text-ink mb-1">
                Reason <span className="text-muted font-normal">(optional)</span>
              </label>
              <select
                id="cancel-reason"
                value={modal.reason}
                onChange={(e) => setModal((m) => m && { ...m, reason: e.target.value })}
                className="w-full border border-hairline rounded-lg px-3 py-2 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-navy"
              >
                <option value="">— select reason —</option>
                <option value="weather">Weather</option>
                <option value="mechanical">Mechanical</option>
                <option value="low_bookings">Low bookings</option>
                <option value="other">Other</option>
              </select>
            </div>

            {modal.error && <p className="text-sm text-warning mb-3">{modal.error}</p>}

            <div className="flex gap-3">
              <button
                onClick={() => setModal(null)}
                disabled={modal.loading}
                className="flex-1 border border-hairline text-ink py-2 rounded-lg text-sm font-medium hover:bg-fill disabled:opacity-50 transition-colors"
              >
                Never mind
              </button>
              <button
                onClick={cancelTrip}
                disabled={modal.loading}
                className="flex-1 bg-warning text-white py-2 rounded-lg text-sm font-medium hover:bg-red-700 disabled:opacity-50 transition-colors"
              >
                {modal.loading ? "Cancelling…" : "Cancel trip & refund all"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function StatCard({
  label,
  value,
  sub,
  accent,
}: {
  label: string;
  value: string;
  sub: string;
  accent: "navy" | "gold" | "green" | "default";
}) {
  const styles = {
    navy: { card: "bg-navy border-navy", label: "text-white/60", value: "text-white", sub: "text-white/50" },
    gold: { card: "bg-white border-gold/30", label: "text-muted", value: "text-gold", sub: "text-muted" },
    green: { card: "bg-success-bg border-success/20", label: "text-success", value: "text-success", sub: "text-success" },
    default: { card: "bg-white border-hairline", label: "text-muted", value: "text-ink", sub: "text-muted" },
  }[accent];

  return (
    <div className={`rounded-xl border px-5 py-4 ${styles.card}`}>
      <div className={`text-xs font-medium uppercase tracking-label mb-1 ${styles.label}`}>{label}</div>
      <div className={`text-2xl font-semibold ${styles.value}`}>{value}</div>
      <div className={`text-xs mt-0.5 ${styles.sub}`}>{sub}</div>
    </div>
  );
}
