"use client";

import { useEffect, useMemo, useState, useCallback } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { fmtTimeCompactET, fmtDayLabelET, fmtLongDateET, fmtLongMonthDayET } from "@/lib/format";
import {
  Panel,
  Button,
  TripList,
  useToast,
  CancelDialog,
  SeatsDialog,
  type TripSettings,
  AddDepartureDialog,
  type TripRowData,
  type ProductOption,
  ErrorState,
  EmptyState,
  LoadingState,
  Lamp,
  CalendarIcon,
  ChevronRightIcon,
  CloseIcon,
  PlusIcon,
  Readouts,
  fmtMoney,
} from "@/components/admin/merchant";

type TodayResponse = {
  trips: TripRowData[];
  today: string;
  stats: { tripsGoingOut: number; peopleBooked: number; seatsForSale: number; takenInTodayCents: number };
  alerts: {
    seasonEnd: { date: string } | null;
    reportsOwed: { count: number; oldestTripId: string | null } | null;
  };
};

type DialogState =
  | { type: "cancel"; tripId: string }
  | { type: "seats"; tripId: string; currentCapacity: number; currentCutoffMinutes: number | null }
  | { type: "addDeparture" }
  | null;

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export default function TodayPage() {
  const router = useRouter();
  const { showToast } = useToast();
  const [data, setData] = useState<TodayResponse | null>(null);
  const [error, setError] = useState(false);
  const [products, setProducts] = useState<ProductOption[]>([]);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const [dialog, setDialog] = useState<DialogState>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setError(false);
    try {
      const res = await fetch("/api/admin/today");
      if (!res.ok) throw new Error("failed");
      setData(await res.json());
    } catch {
      setError(true);
    }
  }, []);

  useEffect(() => {
    load();
    fetch("/api/admin/settings/products")
      .then((r) => (r.ok ? r.json() : []))
      // Turned-off trip types aren't offered for new departures.
      .then((all) => setProducts(all.filter((p: ProductOption & { active: boolean }) => p.active)))
      .catch(() => {});
  }, [load]);

  const todayTrips = useMemo(() => (data ? data.trips.filter((t) => t.departureDate === data.today) : []), [data]);

  const upcomingDays = useMemo(() => {
    if (!data) return [];
    const byDate = new Map<string, TripRowData[]>();
    for (const t of data.trips) {
      if (t.departureDate === data.today) continue;
      if (!byDate.has(t.departureDate)) byDate.set(t.departureDate, []);
      byDate.get(t.departureDate)!.push(t);
    }
    return [...byDate.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .slice(0, 3)
      .map(([date, trips]) => {
        const live = trips.filter((t) => t.status !== "cancelled");
        return {
          date,
          label: fmtDayLabelET(date, data.today),
          summary: live.map((t) => `${fmtTimeCompactET(t.startTime)} ${t.vessel.name}`).join(" · ") || "Nothing scheduled",
          ticketsSold: live.reduce((s, t) => s + t.ticketsSold, 0),
          capacity: live.reduce((s, t) => s + t.capacity, 0),
        };
      });
  }, [data]);

  async function refreshAfterAction() {
    await load();
  }

  async function submitCancel(tripId: string, reason: string) {
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/trips/${tripId}/cancel`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ reason }),
      });
      const body = await res.json();
      if (!res.ok) {
        showToast(body.error ?? "Couldn't cancel the trip.", "error");
        return;
      }
      showToast(
        body.bookingsCancelled > 0
          ? `Trip cancelled. ${body.ticketsVoided} refund${body.ticketsVoided === 1 ? "" : "s"} ${body.ticketsVoided === 1 ? "is" : "are"} on their way.`
          : "Trip cancelled.",
      );
      setDialog(null);
      await refreshAfterAction();
    } finally {
      setBusy(false);
    }
  }

  async function submitSeats(tripId: string, settings: TripSettings) {
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/trips/${tripId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(settings),
      });
      const body = await res.json();
      if (!res.ok) {
        showToast(body.error ?? "Couldn't update seats.", "error");
        return;
      }
      showToast(`Trip updated — ${settings.capacity} seats.`);
      setDialog(null);
      await refreshAfterAction();
    } finally {
      setBusy(false);
    }
  }

  async function submitAddDeparture(form: {
    productId: string;
    departureTime: string;
    returnTime: string;
    capacity: number;
  }) {
    if (!data) return;
    setBusy(true);
    try {
      const res = await fetch("/api/admin/trips", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...form, departureDate: data.today }),
      });
      const body = await res.json();
      if (!res.ok) {
        showToast(body.error ?? "Couldn't add the departure.", "error");
        return;
      }
      showToast("Departure added.");
      setDialog(null);
      await refreshAfterAction();
    } finally {
      setBusy(false);
    }
  }

  const actions = {
    onWhosComing: (tripId: string) => router.push(`/admin/trips/${tripId}/passengers`),
    onSeats: (tripId: string) => {
      const trip = todayTrips.find((t) => t.id === tripId);
      if (trip)
        setDialog({
          type: "seats",
          tripId,
          currentCapacity: trip.capacity,
          currentCutoffMinutes: trip.onlineCutoffMinutes,
        });
    },
    onCancel: (tripId: string) => setDialog({ type: "cancel", tripId }),
  };

  const dialogTrip =
    dialog && dialog.type !== "addDeparture" ? todayTrips.find((t) => t.id === dialog.tripId) ?? null : null;

  const live = todayTrips.filter((t) => t.status !== "cancelled");
  const cancelledCount = todayTrips.length - live.length;
  const seatsOnLiveTrips = live.reduce((s, t) => s + t.capacity, 0);
  const boatCount = new Set(todayTrips.map((t) => t.vessel.name)).size;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-title-page">Today</h1>
          <div className="text-body text-ob-ink-2 mt-1">{data ? fmtLongDateET(data.today) : " "}</div>
        </div>
        <div className="flex flex-wrap gap-3 max-md:w-full">
          <Button variant="secondary" size="dock" icon={<CalendarIcon />} className="max-md:hidden" onClick={() => router.push("/admin/calendar")}>
            Open the calendar
          </Button>
          <Button
            variant="key"
            size="dock"
            icon={<PlusIcon />}
            className="max-md:flex-1"
            onClick={() => setDialog({ type: "addDeparture" })}
            disabled={!data}
          >
            Add a departure
          </Button>
        </div>
      </div>

      {error ? (
        <ErrorState
          onRetry={load}
          body={
            <>
              Your trips are safe — this screen just can&rsquo;t load them right now. Customers may not be able to book
              until it&rsquo;s back.
            </>
          }
        />
      ) : (
        <>
          {data && (
            <Alerts
              alerts={data.alerts}
              dismissed={dismissed}
              onDismiss={(key) => setDismissed((prev) => new Set(prev).add(key))}
              onOpenReport={(tripId) => router.push(`/admin/reports?tripId=${tripId}`)}
              onOpenSchedule={() => router.push("/admin/schedule")}
            />
          )}

          <Readouts
            cells={[
              {
                label: "Trips going out",
                value: data ? String(data.stats.tripsGoingOut) : "—",
                sub: data && cancelledCount > 0 ? `${cancelledCount} cancelled` : "",
              },
              {
                label: "People booked",
                value: data ? String(data.stats.peopleBooked) : "—",
                sub: data && seatsOnLiveTrips > 0 ? `of ${seatsOnLiveTrips} seats` : "",
              },
              { label: "Seats still for sale", value: data ? String(data.stats.seatsForSale) : "—", sub: "" },
              { label: "Taken in today", value: data ? fmtMoney(data.stats.takenInTodayCents) : "—", sub: "" },
            ]}
          />

          <Panel aria-labelledby="dep-h">
            <div className="flex flex-col gap-0.5 px-5 py-4 border-b-2 border-ob-rule max-md:px-4">
              <h2 id="dep-h" className="text-title-panel">
                Today&rsquo;s departures
              </h2>
              {data && todayTrips.length > 0 && (
                <div className="text-body-sm text-ob-ink-2">
                  {plural(todayTrips.length, "departure", "departures")} · {plural(boatCount, "boat", "boats")}
                </div>
              )}
            </div>
            {!data ? (
              <LoadingState label="Loading today’s trips…" />
            ) : todayTrips.length === 0 ? (
              <EmptyState
                title="Nothing is going out today."
                body={<>Either today isn&rsquo;t in your weekly schedule, or every trip was cancelled.</>}
                action={
                  <Button variant="strong" onClick={() => setDialog({ type: "addDeparture" })}>
                    Add a departure
                  </Button>
                }
              />
            ) : (
              <TripList trips={todayTrips} actions={actions} />
            )}
          </Panel>

          {data && (
            <Panel aria-labelledby="up-h">
              <div className="px-5 py-4 border-b-2 border-ob-rule max-md:px-4">
                <h2 id="up-h" className="text-title-panel">
                  Coming up
                </h2>
              </div>
              {upcomingDays.length === 0 ? (
                <div className="px-5 py-4 text-body-sm text-ob-ink-2">Nothing on the calendar in the next few days.</div>
              ) : (
                upcomingDays.map((day) => (
                  <Link
                    key={day.date}
                    href={`/admin/calendar?date=${day.date}`}
                    className="flex items-center gap-4 min-h-16 py-3 pl-5 pr-3 border-t border-ob-hair first-of-type:border-t-0 text-ob-ink no-underline hover:bg-ob-panel-2 max-md:pl-4"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="text-17 font-bold">{day.label}</div>
                      <div className="text-body-sm text-ob-ink-2 [text-wrap:pretty]">{day.summary}</div>
                    </div>
                    <div className="flex-none font-num text-body tabular-nums whitespace-nowrap">
                      {day.ticketsSold}
                      <span className="text-ob-ink-3"> of {day.capacity}</span>
                    </div>
                    <span className="text-ob-ink-3">
                      <ChevronRightIcon size={20} />
                    </span>
                  </Link>
                ))
              )}
            </Panel>
          )}
        </>
      )}

      <CancelDialog
        open={dialog?.type === "cancel"}
        busy={busy}
        trip={dialogTrip}
        onClose={() => setDialog(null)}
        onConfirm={(reason) => dialog?.type === "cancel" && submitCancel(dialog.tripId, reason)}
      />
      <SeatsDialog
        open={dialog?.type === "seats"}
        busy={busy}
        trip={dialogTrip}
        currentCapacity={dialog?.type === "seats" ? dialog.currentCapacity : 0}
        currentCutoffMinutes={dialog?.type === "seats" ? dialog.currentCutoffMinutes : null}
        onClose={() => setDialog(null)}
        onConfirm={(settings) => dialog?.type === "seats" && submitSeats(dialog.tripId, settings)}
      />
      <AddDepartureDialog
        open={dialog?.type === "addDeparture"}
        busy={busy}
        products={products}
        dateLabel={data ? fmtLongMonthDayET(data.today) : ""}
        onClose={() => setDialog(null)}
        onConfirm={submitAddDeparture}
      />
    </div>
  );
}

function Alerts({
  alerts,
  dismissed,
  onDismiss,
  onOpenReport,
  onOpenSchedule,
}: {
  alerts: TodayResponse["alerts"];
  dismissed: Set<string>;
  onDismiss: (key: string) => void;
  onOpenReport: (tripId: string) => void;
  onOpenSchedule: () => void;
}) {
  // Design spec also has a weather alert (fires when a trip departs >=17:00,
  // fixed "small craft advisory" copy). Dropped for now — no real weather
  // data source exists, and firing that copy off departure time alone would
  // show captains false safety information on days with normal weather.
  const items: { key: string; caution: boolean; title: string; body: string; cta?: () => void; ctaLabel?: string }[] =
    [];

  if (alerts.reportsOwed && !dismissed.has("reports-owed")) {
    items.push({
      key: "reports-owed",
      caution: true,
      title: "Reports owed",
      body: `${alerts.reportsOwed.count} trip${alerts.reportsOwed.count === 1 ? "" : "s"} still need${alerts.reportsOwed.count === 1 ? "s" : ""} a report.`,
      ctaLabel: "Post the report",
      cta: () => alerts.reportsOwed?.oldestTripId && onOpenReport(alerts.reportsOwed.oldestTripId),
    });
  }
  if (alerts.seasonEnd && !dismissed.has("season-end")) {
    items.push({
      key: "season-end",
      caution: false,
      title: "Your schedule is running out",
      body: `Your schedule runs out ${fmtLongMonthDayET(alerts.seasonEnd.date)} — nothing is on the calendar after that, so customers can't book past it.`,
      ctaLabel: "Weekly schedule",
      cta: onOpenSchedule,
    });
  }

  if (items.length === 0) return null;

  return (
    <div className="flex flex-col bg-ob-panel border-2 border-ob-rule rounded-ob">
      {items.map((item) => (
        <div
          key={item.key}
          className="flex flex-wrap items-center gap-x-4 gap-y-3 py-3.5 pl-5 pr-2 border-t border-ob-hair first:border-t-0 max-md:pl-4"
        >
          {item.caution ? <Lamp tone="caution" /> : <Lamp tone="ink" shape="hollow" />}
          <div className="flex-[1_1_280px] min-w-0">
            <div className="text-body font-extrabold">{item.title}</div>
            <div className="text-body-sm text-ob-ink-2 [text-wrap:pretty]">{item.body}</div>
          </div>
          <div className="flex items-center gap-1 ml-auto">
            {item.cta && (
              <Button variant="secondary" className="text-body-sm" iconAfter={<ChevronRightIcon />} onClick={item.cta}>
                {item.ctaLabel}
              </Button>
            )}
            <button
              type="button"
              onClick={() => onDismiss(item.key)}
              aria-label={`Dismiss: ${item.title}`}
              className="flex items-center justify-center w-12 h-12 text-ob-ink-3 hover:text-ob-ink"
            >
              <CloseIcon size={20} />
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
