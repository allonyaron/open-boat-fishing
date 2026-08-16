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

const STATUS_LABEL: Record<TripRow["status"], string> = {
  scheduled: "Scheduled",
  pending_settlement: "Pending",
  sailed: "Sailed",
  cancelled: "Cancelled",
};

const STATUS_COLOR: Record<TripRow["status"], string> = {
  scheduled: "bg-blue-100 text-blue-800",
  pending_settlement: "bg-yellow-100 text-yellow-800",
  sailed: "bg-green-100 text-green-800",
  cancelled: "bg-red-100 text-red-800",
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
  return new Date(y, m - 1, d).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

export default function AdminTripsPage() {
  const [trips, setTrips] = useState<TripRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState<CancelModal | null>(null);

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

  // Group trips by date
  const grouped: Record<string, TripRow[]> = {};
  for (const trip of trips) {
    const key = trip.departureDate;
    if (!grouped[key]) grouped[key] = [];
    grouped[key].push(trip);
  }

  return (
    <>
      <div className="max-w-5xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-2xl font-semibold text-gray-900">Trips</h1>
          <button onClick={load} className="text-sm text-gray-500 hover:text-gray-700">
            Refresh
          </button>
        </div>

        {loading ? (
          <div className="text-center text-gray-400 py-16">Loading…</div>
        ) : trips.length === 0 ? (
          <div className="text-center text-gray-400 py-16">No upcoming trips</div>
        ) : (
          <div className="space-y-6">
            {Object.entries(grouped).map(([date, dayTrips]) => (
              <section key={date}>
                <h2 className="text-sm font-medium text-gray-500 uppercase tracking-wide mb-2">
                  {fmtDate(date)}
                </h2>
                <div className="bg-white rounded-xl border border-gray-200 divide-y divide-gray-100">
                  {dayTrips.map((trip) => {
                    const sold = Number(trip.ticketsSold);
                    const pct = trip.capacity > 0 ? Math.round((sold / trip.capacity) * 100) : 0;
                    const canCancel = trip.status !== "cancelled";

                    return (
                      <div key={trip.id} className="flex items-center gap-4 px-5 py-4">
                        {/* Vessel color swatch */}
                        <div
                          className="w-3 h-10 rounded-full flex-shrink-0"
                          style={{ backgroundColor: trip.vessel.color }}
                        />

                        {/* Main info */}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-medium text-gray-900">{trip.vessel.name}</span>
                            <span className="text-gray-400">·</span>
                            <span className="text-gray-600 text-sm">
                              {trip.product.displayName}
                            </span>
                            <span
                              className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_COLOR[trip.status]}`}
                            >
                              {STATUS_LABEL[trip.status]}
                            </span>
                          </div>
                          <div className="text-sm text-gray-500 mt-0.5">
                            {fmt(trip.startTime)} →{" "}
                            {new Date(trip.endTime).toLocaleTimeString("en-US", {
                              hour: "numeric",
                              minute: "2-digit",
                              hour12: true,
                            })}
                            {trip.cancellationReason && (
                              <span className="ml-2 text-red-500">· {trip.cancellationReason}</span>
                            )}
                          </div>
                        </div>

                        {/* Seats */}
                        <div className="text-right flex-shrink-0 min-w-[90px]">
                          <div className="text-sm font-medium text-gray-900">
                            {sold} / {trip.capacity}
                          </div>
                          <div className="text-xs text-gray-400">{pct}% booked</div>
                          <div className="mt-1 h-1.5 w-20 bg-gray-100 rounded-full overflow-hidden">
                            <div
                              className="h-full rounded-full bg-blue-500 transition-all"
                              style={{ width: `${pct}%` }}
                            />
                          </div>
                        </div>

                        {/* Actions */}
                        <div className="flex-shrink-0 flex items-center gap-2">
                          <Link
                            href={`/admin/trips/${trip.id}`}
                            className="text-sm text-blue-600 hover:text-blue-800 font-medium px-3 py-1.5 rounded-lg hover:bg-blue-50 transition-colors"
                          >
                            Manifest
                          </Link>
                          {canCancel ? (
                            <button
                              onClick={() =>
                                setModal({ trip, reason: "", loading: false, error: "" })
                              }
                              className="text-sm text-red-600 hover:text-red-800 font-medium px-3 py-1.5 rounded-lg hover:bg-red-50 transition-colors"
                            >
                              Cancel trip
                            </button>
                          ) : (
                            <span className="text-sm text-gray-300 px-3">—</span>
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

      {/* Cancellation confirmation modal */}
      {modal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-1">Cancel trip?</h2>
            <p className="text-sm text-gray-600 mb-4">
              <strong>{modal.trip.vessel.name}</strong> · {modal.trip.product.displayName}
              <br />
              {fmt(modal.trip.startTime)}
              <br />
              <span className="text-red-600 font-medium">
                {Number(modal.trip.ticketsSold)} tickets will be refunded automatically.
              </span>
            </p>

            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Reason <span className="text-gray-400 font-normal">(optional)</span>
              </label>
              <select
                value={modal.reason}
                onChange={(e) => setModal((m) => m && { ...m, reason: e.target.value })}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-500"
              >
                <option value="">— select reason —</option>
                <option value="weather">Weather</option>
                <option value="mechanical">Mechanical</option>
                <option value="low_bookings">Low bookings</option>
                <option value="other">Other</option>
              </select>
            </div>

            {modal.error && <p className="text-sm text-red-600 mb-3">{modal.error}</p>}

            <div className="flex gap-3">
              <button
                onClick={() => setModal(null)}
                disabled={modal.loading}
                className="flex-1 border border-gray-300 text-gray-700 py-2 rounded-lg text-sm font-medium hover:bg-gray-50 disabled:opacity-50 transition-colors"
              >
                Never mind
              </button>
              <button
                onClick={cancelTrip}
                disabled={modal.loading}
                className="flex-1 bg-red-600 text-white py-2 rounded-lg text-sm font-medium hover:bg-red-700 disabled:opacity-50 transition-colors"
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
