"use client";

import { useEffect, useState, useCallback } from "react";
import { useSearchParams } from "next/navigation";
import { fmtTimeET, fmtDayLabelET } from "@/lib/format";
import { todayET } from "@/lib/date-et";
import { Card, CardRow, Button, useToast, ReportDialog, type ReportFormInput } from "@/components/admin/merchant";

type PendingTrip = {
  id: string;
  departureDate: string;
  startTime: string;
  ticketsSold: number;
  vessel: { name: string; color: string };
  product: { displayName: string };
};

type PublishedReport = {
  id: string;
  tripId: string;
  catchSummary: string | null;
  fishCounts: { species: string; count: number }[];
  photoUrls: string[];
  createdAt: string;
  departureDate: string;
  startTime: string;
  vesselName: string;
  vesselColor: string;
  productName: string;
};

type DialogState = { tripId: string; label: string; initial?: ReportFormInput } | null;

export default function ReportsPage() {
  const searchParams = useSearchParams();
  const { showToast } = useToast();
  const today = todayET();

  const [pending, setPending] = useState<PendingTrip[] | null>(null);
  const [published, setPublished] = useState<PublishedReport[] | null>(null);
  const [error, setError] = useState(false);
  const [dialog, setDialog] = useState<DialogState>(null);
  const [busy, setBusy] = useState(false);
  const [autoOpenedFor, setAutoOpenedFor] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(false);
    try {
      const [pendingRes, publishedRes] = await Promise.all([
        fetch("/api/admin/reports/pending"),
        fetch("/api/reports"),
      ]);
      if (!pendingRes.ok || !publishedRes.ok) throw new Error("failed");
      setPending(await pendingRes.json());
      const publishedBody = await publishedRes.json();
      setPublished(publishedBody.items);
    } catch {
      setError(true);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Deep-link from Today's "Reports owed" alert — auto-open the composer for
  // the trip it pointed at, once.
  useEffect(() => {
    const tripId = searchParams.get("tripId");
    if (!tripId || !pending || autoOpenedFor === tripId) return;
    const trip = pending.find((t) => t.id === tripId);
    if (trip) {
      setDialog({ tripId: trip.id, label: tripLabel(trip) });
      setAutoOpenedFor(tripId);
    }
  }, [searchParams, pending, autoOpenedFor]);

  function tripLabel(trip: PendingTrip) {
    return `${trip.product.displayName} · ${trip.vessel.name} — ${fmtDayLabelET(trip.departureDate, today)} · ${fmtTimeET(trip.startTime)} trip`;
  }

  async function submitReport(input: ReportFormInput) {
    if (!dialog) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/trips/${dialog.tripId}/report`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          catchSummary: input.catchSummary || undefined,
          fishCounts: input.fishCounts,
          photoUrls: input.photoUrls,
        }),
      });
      const body = await res.json();
      if (!res.ok) {
        showToast(body.error ?? "Couldn't save the report.");
        return;
      }
      showToast("Posted. It's live on your Fishing Reports page.");
      setDialog(null);
      await load();
    } finally {
      setBusy(false);
    }
  }

  if (error) {
    return (
      <div className="rounded-xl border border-merchant-red-tint bg-[#fff8f7] p-5">
        <div className="text-14 font-semibold text-merchant-red">Can&rsquo;t reach the booking system</div>
        <p className="mt-1 text-13 text-merchant-muted">Reports just can&rsquo;t load right now.</p>
        <Button variant="secondary" className="mt-3" onClick={load}>
          Try again
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-20 font-bold text-merchant-ink" style={{ letterSpacing: "-0.01em" }}>
        Reports
      </h1>

      <Card>
        <div className="px-4 py-3.5 border-b border-merchant-hairline">
          <div className="text-15 font-bold text-merchant-ink">Waiting on a report</div>
        </div>
        {!pending ? (
          <CardRow className="text-13 text-merchant-muted">Loading…</CardRow>
        ) : pending.length === 0 ? (
          <CardRow className="text-center py-8">
            <div className="text-14 font-semibold text-merchant-ink">Every trip that sailed has a report.</div>
            <div className="text-13 text-merchant-muted mt-1">Nice work.</div>
          </CardRow>
        ) : (
          pending.map((trip) => (
            <CardRow key={trip.id} className="flex items-center gap-3">
              <span className="w-1 h-10 rounded-full flex-shrink-0" style={{ backgroundColor: trip.vessel.color }} />
              <div className="flex-1 min-w-0">
                <div className="text-14 font-semibold text-merchant-ink">
                  {trip.product.displayName} · {trip.vessel.name}
                </div>
                <div className="text-13 text-merchant-muted">
                  {fmtDayLabelET(trip.departureDate, today)} · {fmtTimeET(trip.startTime)} trip
                </div>
                <div className="text-13 text-merchant-muted">{trip.ticketsSold} aboard</div>
              </div>
              <Button
                variant="primary"
                className="flex-shrink-0"
                onClick={() => setDialog({ tripId: trip.id, label: tripLabel(trip) })}
              >
                Post the report
              </Button>
            </CardRow>
          ))
        )}
      </Card>

      <Card>
        <div className="px-4 py-3.5 border-b border-merchant-hairline">
          <div className="text-15 font-bold text-merchant-ink">On your website now</div>
        </div>
        {!published ? (
          <CardRow className="text-13 text-merchant-muted">Loading…</CardRow>
        ) : published.length === 0 ? (
          <CardRow className="text-13 text-merchant-muted">Nothing published yet.</CardRow>
        ) : (
          published.map((r) => (
            <CardRow key={r.id} className="flex items-start gap-3">
              <span className="w-1 h-10 rounded-full flex-shrink-0 mt-0.5" style={{ backgroundColor: r.vesselColor }} />
              <div className="flex-1 min-w-0">
                <div className="text-14 font-semibold text-merchant-ink">
                  {r.productName} · {r.vesselName}
                </div>
                <div className="text-13 text-merchant-muted">
                  {fmtDayLabelET(r.departureDate, today)} · {fmtTimeET(r.startTime)}
                </div>
                {r.catchSummary && (
                  <p className="text-13 text-merchant-muted mt-1 [text-wrap:pretty]">{r.catchSummary}</p>
                )}
                <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
                  {r.fishCounts.map((fc, i) => (
                    <span
                      key={i}
                      className="inline-flex items-center rounded-full bg-merchant-teal text-merchant-green text-12 font-semibold px-2.5 py-0.5"
                    >
                      {fc.count} {fc.species}
                    </span>
                  ))}
                  {r.photoUrls.length > 0 && (
                    <span className="text-12 text-merchant-faint">
                      {r.photoUrls.length} photo{r.photoUrls.length === 1 ? "" : "s"}
                    </span>
                  )}
                </div>
              </div>
              <Button
                variant="secondary"
                className="flex-shrink-0"
                onClick={() =>
                  setDialog({
                    tripId: r.tripId,
                    label: `${r.productName} · ${r.vesselName} — ${fmtDayLabelET(r.departureDate, today)} · ${fmtTimeET(r.startTime)} trip`,
                    initial: { catchSummary: r.catchSummary ?? "", fishCounts: r.fishCounts, photoUrls: r.photoUrls },
                  })
                }
              >
                Change it
              </Button>
            </CardRow>
          ))
        )}
      </Card>

      <ReportDialog
        open={dialog !== null}
        busy={busy}
        tripId={dialog?.tripId ?? null}
        tripLabel={dialog?.label ?? ""}
        initial={dialog?.initial}
        onClose={() => setDialog(null)}
        onConfirm={submitReport}
      />
    </div>
  );
}
