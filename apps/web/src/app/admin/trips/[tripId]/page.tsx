"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";

type TicketRow = {
  id: string;
  ticketType: "adult" | "child" | "senior";
  priceCents: number;
  feeAmountCents: number;
  feeStatus: "held" | "earned" | "reversed";
  voided: boolean;
  passengerName: string | null;
  checkedIn: boolean;
  checkedInAt: string | null;
};

type BookingRow = {
  id: string;
  confirmationCode: string;
  customerName: string;
  customerEmail: string;
  customerPhone: string | null;
  status: "pending" | "confirmed" | "cancelled";
  totalCents: number;
  createdAt: string;
  tickets: TicketRow[];
};

type TripDetail = {
  id: string;
  departureDate: string;
  startTime: string;
  endTime: string;
  boardingTime: string | null;
  capacity: number;
  seatsRemaining: number;
  status: "scheduled" | "pending_settlement" | "sailed" | "cancelled";
  cancellationReason: string | null;
  cancelledAt: string | null;
  vessel: { id: string; name: string; color: string };
  product: { id: string; displayName: string; category: string };
};

type ApiResponse = { trip: TripDetail; bookings: BookingRow[] };

function fmtTime(iso: string) {
  return new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true });
}

function fmtDate(date: string) {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

function dollars(cents: number) {
  return `$${(cents / 100).toFixed(2)}`;
}

const TICKET_LABEL = { adult: "Adult", child: "Child", senior: "Senior" };

export default function TripDetailPage() {
  const { tripId } = useParams<{ tripId: string }>();
  const router = useRouter();
  const [data, setData] = useState<ApiResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refunding, setRefunding] = useState<string | null>(null);
  const [refundError, setRefundError] = useState<string | null>(null);
  // Capacity edit state
  const [editingCapacity, setEditingCapacity] = useState(false);
  const [capacityInput, setCapacityInput] = useState("");
  const [capacityError, setCapacityError] = useState<string | null>(null);
  const [savingCapacity, setSavingCapacity] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await fetch(`/api/admin/trips/${tripId}`);
    if (res.status === 401) { router.push("/admin/login"); return; }
    if (res.ok) setData(await res.json());
    setLoading(false);
  }, [tripId, router]);

  useEffect(() => { load(); }, [load]);

  async function refundTicket(ticketId: string) {
    if (!confirm("Refund this ticket? This cannot be undone.")) return;
    setRefunding(ticketId);
    setRefundError(null);
    const res = await fetch(`/api/admin/tickets/${ticketId}/refund`, { method: "POST" });
    const body = await res.json();
    if (res.ok) {
      await load();
    } else {
      setRefundError(body.error ?? "Refund failed");
    }
    setRefunding(null);
  }

  function startEditCapacity(current: number) {
    setCapacityInput(String(current));
    setCapacityError(null);
    setEditingCapacity(true);
  }

  async function saveCapacity() {
    const val = parseInt(capacityInput, 10);
    if (isNaN(val) || val < 1) {
      setCapacityError("Enter a whole number ≥ 1");
      return;
    }
    setSavingCapacity(true);
    setCapacityError(null);
    const res = await fetch(`/api/admin/trips/${tripId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ capacity: val }),
    });
    const body = await res.json();
    if (res.ok) {
      setEditingCapacity(false);
      await load();
    } else {
      setCapacityError(body.error ?? "Save failed");
    }
    setSavingCapacity(false);
  }

  if (loading || !data) {
    return <div className="text-center text-gray-400 py-16">{loading ? "Loading…" : "Trip not found"}</div>;
  }

  const { trip, bookings } = data;
  const activeTickets = bookings.flatMap((b) => b.tickets.filter((t) => !t.voided));
  const checkedInCount = activeTickets.filter((t) => t.checkedIn).length;

  return (
    <div className="max-w-4xl mx-auto">
      {/* Back link */}
      <Link href="/admin/trips" className="text-sm text-gray-500 hover:text-gray-700 flex items-center gap-1 mb-4">
        ← Trips
      </Link>

      {/* Trip header */}
      <div className="bg-white rounded-xl border border-gray-200 p-5 mb-6">
        <div className="flex items-start gap-4">
          <div className="w-3 h-12 rounded-full flex-shrink-0 mt-1" style={{ backgroundColor: trip.vessel.color }} />
          <div className="flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-xl font-semibold text-gray-900">{trip.vessel.name}</h1>
              <span className="text-gray-400">·</span>
              <span className="text-gray-600">{trip.product.displayName}</span>
            </div>
            <div className="text-gray-500 text-sm mt-1">
              {fmtDate(trip.departureDate)} · {fmtTime(trip.startTime)} → {fmtTime(trip.endTime)}
              {trip.boardingTime && <span className="ml-2 text-gray-400">Board {trip.boardingTime}</span>}
            </div>
            <div className="flex items-center gap-4 mt-2 text-sm flex-wrap">
              <span className="text-gray-700">
                <strong>{activeTickets.length}</strong> / {editingCapacity ? capacityInput || "?" : trip.capacity} seats sold
              </span>
              <span className="text-gray-500">{checkedInCount} checked in</span>
              {trip.status === "cancelled" && (
                <span className="text-red-600 font-medium">
                  Cancelled{trip.cancellationReason ? ` · ${trip.cancellationReason}` : ""}
                </span>
              )}
            </div>

            {/* Capacity edit */}
            {trip.status !== "cancelled" && (
              <div className="mt-3">
                {editingCapacity ? (
                  <div className="flex items-center gap-2 flex-wrap">
                    <label className="text-xs text-gray-500">Capacity:</label>
                    <input
                      type="number"
                      min={activeTickets.length}
                      value={capacityInput}
                      onChange={(e) => { setCapacityInput(e.target.value); setCapacityError(null); }}
                      onKeyDown={(e) => { if (e.key === "Enter") saveCapacity(); if (e.key === "Escape") setEditingCapacity(false); }}
                      className="w-20 border border-gray-300 rounded-md px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                      autoFocus
                    />
                    <button
                      onClick={saveCapacity}
                      disabled={savingCapacity}
                      className="text-xs bg-blue-600 text-white px-3 py-1 rounded-md hover:bg-blue-700 disabled:opacity-50 transition-colors"
                    >
                      {savingCapacity ? "Saving…" : "Save"}
                    </button>
                    <button
                      onClick={() => setEditingCapacity(false)}
                      className="text-xs text-gray-500 hover:text-gray-700 px-2 py-1"
                    >
                      Cancel
                    </button>
                    {capacityError && (
                      <span className="text-xs text-red-600">{capacityError}</span>
                    )}
                  </div>
                ) : (
                  <button
                    onClick={() => startEditCapacity(trip.capacity)}
                    className="text-xs text-gray-400 hover:text-gray-600 underline underline-offset-2 transition-colors"
                  >
                    Edit capacity ({trip.capacity})
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Refund error banner */}
      {refundError && (
        <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-4 py-3 mb-4 flex items-center justify-between">
          {refundError}
          <button onClick={() => setRefundError(null)} className="ml-4 text-red-500 hover:text-red-700">✕</button>
        </div>
      )}

      {/* Manifest */}
      {bookings.length === 0 ? (
        <div className="text-center text-gray-400 py-12">No bookings for this trip</div>
      ) : (
        <div className="space-y-4">
          {bookings.map((booking) => {
            const activeTickets = booking.tickets.filter((t) => !t.voided);
            const voidedTickets = booking.tickets.filter((t) => t.voided);

            return (
              <div key={booking.id} className="bg-white rounded-xl border border-gray-200">
                {/* Booking header */}
                <div className="px-5 py-4 border-b border-gray-100">
                  <div className="flex items-center justify-between flex-wrap gap-2">
                    <div>
                      <span className="font-medium text-gray-900">{booking.customerName}</span>
                      <span className="text-gray-500 text-sm ml-2">{booking.customerEmail}</span>
                      {booking.customerPhone && (
                        <span className="text-gray-500 text-sm ml-2">{booking.customerPhone}</span>
                      )}
                    </div>
                    <div className="flex items-center gap-3 text-sm">
                      <span className="font-mono text-gray-600 bg-gray-100 px-2 py-0.5 rounded">
                        {booking.confirmationCode}
                      </span>
                      <span className="text-gray-500">{dollars(booking.totalCents)}</span>
                    </div>
                  </div>
                </div>

                {/* Tickets */}
                <div className="divide-y divide-gray-50">
                  {activeTickets.map((ticket) => (
                    <div key={ticket.id} className="flex items-center gap-4 px-5 py-3">
                      <div className="flex-1 flex items-center gap-3">
                        <span className="text-sm font-medium text-gray-800">
                          {TICKET_LABEL[ticket.ticketType]}
                        </span>
                        {ticket.passengerName && (
                          <span className="text-sm text-gray-500">{ticket.passengerName}</span>
                        )}
                        <span className="text-sm text-gray-400">{dollars(ticket.priceCents)}</span>
                      </div>

                      {/* Check-in status (stubbed) */}
                      <div className="text-sm">
                        {ticket.checkedIn ? (
                          <span className="text-green-600 font-medium">
                            ✓ Checked in {ticket.checkedInAt ? fmtTime(ticket.checkedInAt) : ""}
                          </span>
                        ) : (
                          <span className="text-gray-400">—</span>
                        )}
                      </div>

                      {/* Refund button — only for confirmed, non-cancelled trips */}
                      {trip.status !== "cancelled" && booking.status === "confirmed" && (
                        <button
                          onClick={() => refundTicket(ticket.id)}
                          disabled={refunding === ticket.id}
                          className="text-xs text-red-600 hover:text-red-800 font-medium px-2 py-1 rounded hover:bg-red-50 transition-colors disabled:opacity-50"
                        >
                          {refunding === ticket.id ? "Refunding…" : "Refund"}
                        </button>
                      )}
                    </div>
                  ))}

                  {voidedTickets.map((ticket) => (
                    <div key={ticket.id} className="flex items-center gap-4 px-5 py-3 bg-gray-50 opacity-50">
                      <span className="text-sm text-gray-400 line-through">
                        {TICKET_LABEL[ticket.ticketType]}
                      </span>
                      <span className="text-xs text-gray-400 ml-auto">Refunded</span>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
