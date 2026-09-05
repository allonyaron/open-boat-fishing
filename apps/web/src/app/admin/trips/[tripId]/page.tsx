"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { useParams, useRouter } from "next/navigation";
import { dollars } from "@openboat/utils";
import { fmtTimeET } from "@/lib/format";
import Link from "next/link";
import { upload } from "@vercel/blob/client";
import Image from "next/image";

type FishCount = { species: string; count: number };

type FishingReport = {
  id: string;
  catchSummary: string | null;
  fishCounts: FishCount[];
  photoUrls: string[];
  createdAt: string;
  updatedAt: string;
};

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
  notes: string | null;
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

function fmtDate(date: string) {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

const TICKET_LABEL = { adult: "Adult", child: "Child", senior: "Senior" };

export default function TripDetailPage() {
  const { tripId } = useParams<{ tripId: string }>();
  const router = useRouter();
  const [data, setData] = useState<ApiResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refunding, setRefunding] = useState<string | null>(null);
  const [refundError, setRefundError] = useState<string | null>(null);
  const [editingCapacity, setEditingCapacity] = useState(false);
  const [capacityInput, setCapacityInput] = useState("");
  const [capacityError, setCapacityError] = useState<string | null>(null);
  const [savingCapacity, setSavingCapacity] = useState(false);
  const [report, setReport] = useState<FishingReport | null>(null);
  const [reportLoaded, setReportLoaded] = useState(false);
  const [catchSummary, setCatchSummary] = useState("");
  const [fishCounts, setFishCounts] = useState<FishCount[]>([]);
  const [photoUrls, setPhotoUrls] = useState<string[]>([]);
  const [uploadingPhotos, setUploadingPhotos] = useState(false);
  const photoInputRef = useRef<HTMLInputElement>(null);
  const [savingReport, setSavingReport] = useState(false);
  const [reportError, setReportError] = useState<string | null>(null);
  const [reportSaved, setReportSaved] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await fetch(`/api/admin/trips/${tripId}`);
    if (res.status === 401) { router.push("/admin/login"); return; }
    if (res.ok) setData(await res.json());
    setLoading(false);
  }, [tripId, router]);

  const loadReport = useCallback(async () => {
    const res = await fetch(`/api/admin/trips/${tripId}/report`);
    if (res.ok) {
      const r: FishingReport = await res.json();
      setReport(r);
      setCatchSummary(r.catchSummary ?? "");
      setFishCounts(r.fishCounts ?? []);
      setPhotoUrls(r.photoUrls ?? []);
    }
    setReportLoaded(true);
  }, [tripId]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    if (data && (data.trip.status === "sailed" || data.trip.status === "pending_settlement")) {
      loadReport();
    }
  }, [data, loadReport]);

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
    if (isNaN(val) || val < 1) { setCapacityError("Enter a whole number ≥ 1"); return; }
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

  async function handlePhotoUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    if (!files.length) return;
    setUploadingPhotos(true);
    setReportError(null);
    try {
      const uploaded = await Promise.all(
        files.map((file) =>
          upload(`reports/${tripId}/${Date.now()}-${file.name}`, file, {
            access: "public",
            handleUploadUrl: "/api/reports/upload",
          }),
        ),
      );
      setPhotoUrls((prev) => [...prev, ...uploaded.map((u) => u.url)]);
    } catch {
      setReportError("Photo upload failed — check BLOB_READ_WRITE_TOKEN env var");
    }
    setUploadingPhotos(false);
    if (photoInputRef.current) photoInputRef.current.value = "";
  }

  async function saveReport() {
    setSavingReport(true);
    setReportError(null);
    setReportSaved(false);
    const res = await fetch(`/api/admin/trips/${tripId}/report`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ catchSummary: catchSummary || undefined, fishCounts, photoUrls }),
    });
    const body = await res.json();
    if (res.ok) {
      setReport(body);
      setReportSaved(true);
      setTimeout(() => setReportSaved(false), 3000);
    } else {
      setReportError(body.error ?? "Failed to save report");
    }
    setSavingReport(false);
  }

  function addFishCount() {
    setFishCounts((prev) => [...prev, { species: "", count: 0 }]);
  }
  function updateFishCount(index: number, field: keyof FishCount, value: string | number) {
    setFishCounts((prev) => prev.map((fc, i) => (i === index ? { ...fc, [field]: value } : fc)));
  }
  function removeFishCount(index: number) {
    setFishCounts((prev) => prev.filter((_, i) => i !== index));
  }

  if (loading || !data) {
    return (
      <div className="text-center text-muted py-16 text-sm">
        {loading ? "Loading…" : "Trip not found"}
      </div>
    );
  }

  const { trip, bookings } = data;
  const activeTickets = bookings.flatMap((b) => b.tickets.filter((t) => !t.voided));
  const checkedInCount = activeTickets.filter((t) => t.checkedIn).length;

  return (
    <div className="max-w-4xl mx-auto">
      {/* Back */}
      <Link
        href="/admin/trips"
        className="text-sm text-muted hover:text-ink flex items-center gap-1 mb-5 transition-colors"
      >
        ← Trips
      </Link>

      {/* Trip header card */}
      <div className="bg-white rounded-xl border border-hairline p-5 mb-5">
        <div className="flex items-start gap-4">
          <div className="w-1.5 self-stretch rounded-full flex-shrink-0" style={{ backgroundColor: trip.vessel.color }} />
          <div className="flex-1">
            <div className="flex items-center gap-2 flex-wrap mb-1">
              <h1 className="text-lg font-semibold text-ink">{trip.vessel.name}</h1>
              <span className="text-muted">·</span>
              <span className="text-muted text-sm">{trip.product.displayName}</span>
            </div>
            <div className="text-sm text-muted">
              {fmtDate(trip.departureDate)} · {fmtTimeET(trip.startTime)} → {fmtTimeET(trip.endTime)}
              {trip.boardingTime && (
                <span className="ml-2 text-faint">Board {trip.boardingTime}</span>
              )}
            </div>
            <div className="flex items-center gap-4 mt-2 text-sm flex-wrap">
              <span className="text-ink">
                <strong>{activeTickets.length}</strong> /{" "}
                {editingCapacity ? capacityInput || "?" : trip.capacity} seats sold
              </span>
              <span className="text-muted">{checkedInCount} checked in</span>
              {trip.status === "cancelled" && (
                <span className="text-warning font-medium">
                  Cancelled{trip.cancellationReason ? ` · ${trip.cancellationReason}` : ""}
                </span>
              )}
            </div>

            {/* Capacity edit */}
            {trip.status !== "cancelled" && (
              <div className="mt-3">
                {editingCapacity ? (
                  <div className="flex items-center gap-2 flex-wrap">
                    <label className="text-xs text-muted">Capacity:</label>
                    <input
                      type="number"
                      min={activeTickets.length}
                      value={capacityInput}
                      onChange={(e) => { setCapacityInput(e.target.value); setCapacityError(null); }}
                      onKeyDown={(e) => { if (e.key === "Enter") saveCapacity(); if (e.key === "Escape") setEditingCapacity(false); }}
                      className="w-20 border border-hairline rounded-lg px-2 py-1 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-navy"
                      autoFocus
                    />
                    <button
                      onClick={saveCapacity}
                      disabled={savingCapacity}
                      className="text-xs bg-navy text-white px-3 py-1 rounded-lg hover:opacity-90 disabled:opacity-50 transition-opacity"
                    >
                      {savingCapacity ? "Saving…" : "Save"}
                    </button>
                    <button
                      onClick={() => setEditingCapacity(false)}
                      className="text-xs text-muted hover:text-ink px-2 py-1 transition-colors"
                    >
                      Cancel
                    </button>
                    {capacityError && <span className="text-xs text-warning">{capacityError}</span>}
                  </div>
                ) : (
                  <button
                    onClick={() => startEditCapacity(trip.capacity)}
                    className="text-xs text-faint hover:text-muted underline underline-offset-2 transition-colors"
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
        <div className="bg-warning-bg border border-warning/20 text-warning text-sm rounded-xl px-4 py-3 mb-4 flex items-center justify-between">
          {refundError}
          <button onClick={() => setRefundError(null)} className="ml-4 text-warning/60 hover:text-warning transition-colors">✕</button>
        </div>
      )}

      {/* Fishing Report */}
      {(trip.status === "sailed" || trip.status === "pending_settlement") && reportLoaded && (
        <div className="bg-white rounded-xl border border-hairline p-5 mb-5">
          <h2 className="text-sm font-semibold text-ink mb-4">
            Fishing Report{report ? <span className="ml-2 text-xs font-medium text-success bg-success-bg px-2 py-0.5 rounded-full">Posted</span> : ""}
          </h2>

          <div className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-muted mb-1">Catch Summary</label>
              <textarea
                value={catchSummary}
                onChange={(e) => setCatchSummary(e.target.value)}
                placeholder="Describe today's catch…"
                rows={3}
                className="w-full border border-hairline rounded-lg px-3 py-2 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-navy resize-none"
              />
            </div>

            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="text-xs font-medium text-muted">Fish Counts</label>
                <button onClick={addFishCount} className="text-xs text-navy font-medium hover:opacity-80 transition-opacity">
                  + Add species
                </button>
              </div>
              {fishCounts.length === 0 && (
                <p className="text-xs text-faint italic">No fish counts added</p>
              )}
              <div className="space-y-2">
                {fishCounts.map((fc, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <input
                      type="text"
                      value={fc.species}
                      onChange={(e) => updateFishCount(i, "species", e.target.value)}
                      placeholder="Species"
                      className="flex-1 border border-hairline rounded-lg px-2 py-1 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-navy"
                    />
                    <input
                      type="number"
                      min={0}
                      value={fc.count}
                      onChange={(e) => updateFishCount(i, "count", parseInt(e.target.value, 10) || 0)}
                      className="w-20 border border-hairline rounded-lg px-2 py-1 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-navy"
                    />
                    <button
                      onClick={() => removeFishCount(i)}
                      className="text-xs text-faint hover:text-warning px-1 transition-colors"
                      aria-label="Remove"
                    >
                      ✕
                    </button>
                  </div>
                ))}
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="text-xs font-medium text-muted">Photos</label>
                <button
                  onClick={() => photoInputRef.current?.click()}
                  disabled={uploadingPhotos}
                  className="text-xs text-navy font-medium hover:opacity-80 disabled:opacity-40 transition-opacity"
                >
                  {uploadingPhotos ? "Uploading…" : "+ Add photos"}
                </button>
                <input
                  ref={photoInputRef}
                  type="file"
                  accept="image/jpeg,image/png,image/webp,image/heic"
                  multiple
                  className="hidden"
                  onChange={handlePhotoUpload}
                />
              </div>
              {photoUrls.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {photoUrls.map((url, i) => (
                    <div key={i} className="relative group">
                      <div className="relative w-20 h-20 rounded-xl overflow-hidden bg-fill">
                        <Image src={url} alt={`Photo ${i + 1}`} fill className="object-cover" sizes="80px" />
                      </div>
                      <button
                        onClick={() => setPhotoUrls((prev) => prev.filter((_, idx) => idx !== i))}
                        className="absolute -top-1.5 -right-1.5 w-5 h-5 bg-warning text-white rounded-full text-xs flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                        aria-label="Remove photo"
                      >
                        ✕
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="flex items-center gap-3 pt-1">
              <button
                onClick={saveReport}
                disabled={savingReport || uploadingPhotos}
                className="bg-navy text-white text-sm px-4 py-2 rounded-lg hover:opacity-90 disabled:opacity-50 transition-opacity"
              >
                {savingReport ? "Saving…" : report ? "Update Report" : "Post Report"}
              </button>
              {reportSaved && <span className="text-sm text-success font-medium">Saved</span>}
              {reportError && <span className="text-sm text-warning">{reportError}</span>}
            </div>
          </div>
        </div>
      )}

      {/* Manifest */}
      {bookings.length === 0 ? (
        <div className="text-center text-muted py-12 text-sm">No bookings for this trip</div>
      ) : (
        <div className="space-y-3">
          {bookings.map((booking) => {
            const activeBookingTickets = booking.tickets.filter((t) => !t.voided);
            const voidedTickets = booking.tickets.filter((t) => t.voided);

            return (
              <div key={booking.id} className="bg-white rounded-xl border border-hairline">
                {/* Booking header */}
                <div className="px-5 py-4 border-b border-hairline">
                  <div className="flex items-center justify-between flex-wrap gap-2">
                    <div>
                      <span className="font-semibold text-sm text-ink">{booking.customerName}</span>
                      <span className="text-muted text-sm ml-2">{booking.customerEmail}</span>
                      {booking.customerPhone && (
                        <span className="text-muted text-sm ml-2">{booking.customerPhone}</span>
                      )}
                      {booking.notes && (
                        <div className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-0.5 mt-1 inline-block">
                          Note: {booking.notes}
                        </div>
                      )}
                    </div>
                    <div className="flex items-center gap-3 text-sm">
                      <span className="font-mono text-xs text-muted bg-fill px-2 py-0.5 rounded-lg">
                        {booking.confirmationCode}
                      </span>
                      <span className="text-muted">{dollars(booking.totalCents)}</span>
                    </div>
                  </div>
                </div>

                {/* Tickets */}
                <div className="divide-y divide-hairline">
                  {activeBookingTickets.map((ticket) => (
                    <div key={ticket.id} className="flex items-center gap-4 px-5 py-3">
                      <div className="flex-1 flex items-center gap-3">
                        <span className="text-sm font-medium text-ink">{TICKET_LABEL[ticket.ticketType]}</span>
                        {ticket.passengerName && (
                          <span className="text-sm text-muted">{ticket.passengerName}</span>
                        )}
                        <span className="text-xs text-faint">{dollars(ticket.priceCents)}</span>
                      </div>
                      <div className="text-sm">
                        {ticket.checkedIn ? (
                          <span className="text-success font-medium text-xs">
                            ✓ Checked in {ticket.checkedInAt ? fmtTimeET(ticket.checkedInAt) : ""}
                          </span>
                        ) : (
                          <span className="text-faint text-xs">—</span>
                        )}
                      </div>
                      {trip.status !== "cancelled" && booking.status === "confirmed" && (
                        <button
                          onClick={() => refundTicket(ticket.id)}
                          disabled={refunding === ticket.id}
                          className="text-xs font-medium text-warning hover:text-red-700 px-2 py-1 rounded-lg hover:bg-warning-bg transition-colors disabled:opacity-50"
                        >
                          {refunding === ticket.id ? "Refunding…" : "Refund"}
                        </button>
                      )}
                    </div>
                  ))}

                  {voidedTickets.map((ticket) => (
                    <div key={ticket.id} className="flex items-center gap-4 px-5 py-3 bg-fill opacity-50">
                      <span className="text-sm text-muted line-through">{TICKET_LABEL[ticket.ticketType]}</span>
                      <span className="text-xs text-faint ml-auto">Refunded</span>
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
