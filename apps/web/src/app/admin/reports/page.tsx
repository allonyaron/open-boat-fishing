"use client";

import { useEffect, useState, useCallback } from "react";
import { useSearchParams } from "next/navigation";
import { fmtTimeET, fmtDayLabelET } from "@/lib/format";
import { todayET } from "@/lib/date-et";
import {
  Panel,
  Button,
  Lamp,
  BoatSwatch,
  useToast,
  ReportDialog,
  type ReportFormInput,
  ErrorState,
  LoadingState,
  PencilIcon,
  ImageIcon,
} from "@/components/admin/merchant";

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
        showToast(body.error ?? "Couldn't save the report.", "error");
        return;
      }
      showToast("Posted. It's live on your Fishing Reports page.");
      setDialog(null);
      await load();
    } finally {
      setBusy(false);
    }
  }

  const pendingCount = pending?.length ?? 0;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-title-page">Reports</h1>
        {pending && (
          <div className="text-body text-ob-ink-2 mt-1">
            {pendingCount ? `${pendingCount} trip${pendingCount === 1 ? "" : "s"} still need a report` : "All caught up"}
          </div>
        )}
      </div>

      {error ? (
        <ErrorState onRetry={load} body={<>Reports just can&rsquo;t load right now.</>} />
      ) : (
        <>
          <Panel aria-labelledby="rp-w">
            <div className="flex items-center gap-3 px-5 py-4 border-b-2 border-ob-rule max-md:px-4">
              <h2 id="rp-w" className="text-title-panel">
                Waiting on a report
              </h2>
              {pendingCount > 0 && (
                <span className="inline-flex items-center gap-2 text-body-sm font-bold text-ob-caution-ink">
                  <Lamp tone="caution" size={10} />
                  {pendingCount} owed
                </span>
              )}
            </div>
            {!pending ? (
              <LoadingState label="Loading…" rows={2} />
            ) : pending.length === 0 ? (
              <div className="flex flex-col gap-1 px-5 py-8 max-md:px-4">
                <div className="flex items-center gap-2.5">
                  <Lamp tone="go" />
                  <span className="text-18 font-extrabold">Every trip that sailed has a report.</span>
                </div>
                <div className="text-body text-ob-ink-2">Nice work.</div>
              </div>
            ) : (
              pending.map((trip) => (
                <div
                  key={trip.id}
                  className="flex flex-wrap items-center gap-x-5 gap-y-3 px-5 py-4 border-t border-ob-hair [&:nth-child(2)]:border-t-0 max-md:px-4"
                >
                  <div className="flex-[1_1_300px] min-w-0 flex gap-3.5 items-start">
                    <Lamp tone="caution" className="mt-1.5" />
                    <div className="min-w-0">
                      <div className="text-title-row">
                        {trip.product.displayName} · {trip.vessel.name}
                      </div>
                      <div className="flex flex-wrap gap-x-3.5 gap-y-0.5 text-body-sm text-ob-ink-2">
                        <span>
                          {fmtDayLabelET(trip.departureDate, today)} · {fmtTimeET(trip.startTime)} trip
                        </span>
                        <span>
                          <span className="font-num text-ob-ink">{trip.ticketsSold}</span> aboard
                        </span>
                        <span className="font-bold text-ob-caution-ink">Report owed</span>
                      </div>
                    </div>
                  </div>
                  <Button
                    variant="key"
                    icon={<PencilIcon />}
                    className="max-md:w-full max-md:min-h-tap-main"
                    onClick={() => setDialog({ tripId: trip.id, label: tripLabel(trip) })}
                  >
                    Post the report
                  </Button>
                </div>
              ))
            )}
          </Panel>

          <p className="m-0 -mt-3 text-body-sm text-ob-ink-2">
            Reporting on an older trip? Pick its day on the Calendar, open Who&rsquo;s coming, then Post the report.
          </p>

          <Panel aria-labelledby="rp-l">
            <div className="px-5 py-4 border-b-2 border-ob-rule max-md:px-4">
              <h2 id="rp-l" className="text-title-panel">
                On your website now
              </h2>
            </div>
            {!published ? (
              <LoadingState label="Loading…" rows={2} />
            ) : published.length === 0 ? (
              <div className="px-5 py-6 text-body text-ob-ink-2">Nothing published yet.</div>
            ) : (
              published.map((r) => (
                <div
                  key={r.id}
                  className="flex flex-wrap items-start gap-x-5 gap-y-3 px-5 py-4 border-t border-ob-hair [&:nth-child(2)]:border-t-0 max-md:px-4"
                >
                  <div className="flex-[1_1_360px] min-w-0 flex flex-col gap-2">
                    <div className="flex flex-wrap items-baseline gap-x-3.5 gap-y-1">
                      <span className="inline-flex items-center gap-2 text-title-row">
                        <BoatSwatch color={r.vesselColor} />
                        {r.productName} · {r.vesselName}
                      </span>
                      <span className="text-body-sm text-ob-ink-2">
                        {fmtDayLabelET(r.departureDate, today)} · {fmtTimeET(r.startTime)}
                      </span>
                    </div>
                    {r.catchSummary && (
                      <p className="m-0 text-body text-ob-ink-2 max-w-[72ch] [text-wrap:pretty]">{r.catchSummary}</p>
                    )}
                    {(r.fishCounts.length > 0 || r.photoUrls.length > 0) && (
                      <div className="flex flex-wrap gap-1.5 items-center">
                        {r.fishCounts.map((fc, i) => (
                          <span
                            key={i}
                            className="inline-flex items-baseline gap-1.5 px-2.5 py-1 border border-ob-control rounded-ob text-body-sm whitespace-nowrap"
                          >
                            <span className="font-num font-semibold">{fc.count}</span>
                            {fc.species}
                          </span>
                        ))}
                        {r.photoUrls.length > 0 && (
                          <span className="inline-flex items-center gap-1.5 ml-1 text-body-sm text-ob-ink-2">
                            <ImageIcon />
                            {r.photoUrls.length} photo{r.photoUrls.length === 1 ? "" : "s"}
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                  <Button
                    variant="secondary"
                    className="max-md:w-full max-md:min-h-tap-main"
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
                </div>
              ))
            )}
          </Panel>
        </>
      )}

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
