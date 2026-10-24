"use client";

import { useEffect, useMemo, useState, useCallback } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { fmtTimeCompactET, fmtLongDateET, fmtLongMonthDayET } from "@/lib/format";
import { todayET } from "@/lib/date-et";
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
  ChevronLeftIcon,
  ChevronRightIcon,
  PlusIcon,
} from "@/components/admin/merchant";

type DialogState =
  | { type: "cancel"; tripId: string }
  | { type: "seats"; tripId: string; currentCapacity: number; currentCutoffMinutes: number | null }
  | { type: "addDeparture" }
  | null;

/** All grid cells (YYYY-MM-DD, Sunday-first) for a "YYYY-MM" month, 5 or 6 rows — never a padded-out 6th row with nothing in it. */
function monthGridDates(yearMonth: string): string[] {
  const [y, m] = yearMonth.split("-").map(Number);
  const firstOfMonth = new Date(Date.UTC(y, m - 1, 1));
  const startWeekday = firstOfMonth.getUTCDay();
  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const rows = Math.ceil((startWeekday + daysInMonth) / 7);
  const gridStart = new Date(Date.UTC(y, m - 1, 1 - startWeekday));
  return Array.from({ length: rows * 7 }, (_, i) => {
    const d = new Date(gridStart);
    d.setUTCDate(gridStart.getUTCDate() + i);
    return d.toISOString().slice(0, 10);
  });
}

function monthLabel(yearMonth: string): string {
  const [y, m] = yearMonth.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
}

function shiftMonth(yearMonth: string, delta: number): string {
  const [y, m] = yearMonth.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

const WEEKDAY_HEADERS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export default function CalendarPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { showToast } = useToast();
  const today = todayET();
  const initialDate = searchParams.get("date");
  const initialValid = initialDate && /^\d{4}-\d{2}-\d{2}$/.test(initialDate) ? initialDate : today;
  const [cursor, setCursor] = useState(initialValid.slice(0, 7));
  const [selected, setSelected] = useState(initialValid);
  const [trips, setTrips] = useState<TripRowData[] | null>(null);
  const [error, setError] = useState(false);
  const [products, setProducts] = useState<ProductOption[]>([]);
  const [dialog, setDialog] = useState<DialogState>(null);
  const [busy, setBusy] = useState(false);

  const gridDates = useMemo(() => monthGridDates(cursor), [cursor]);

  const load = useCallback(async () => {
    setError(false);
    try {
      const from = gridDates[0];
      const to = gridDates[gridDates.length - 1];
      const res = await fetch(`/api/admin/trips?from=${from}&to=${to}&limit=400`);
      if (!res.ok) throw new Error("failed");
      setTrips(await res.json());
    } catch {
      setError(true);
    }
  }, [gridDates]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    fetch("/api/admin/settings/products")
      .then((r) => (r.ok ? r.json() : []))
      .then(setProducts)
      .catch(() => {});
  }, []);

  const tripsByDate = useMemo(() => {
    const map = new Map<string, TripRowData[]>();
    for (const t of trips ?? []) {
      if (!map.has(t.departureDate)) map.set(t.departureDate, []);
      map.get(t.departureDate)!.push(t);
    }
    return map;
  }, [trips]);

  const selectedTrips = tripsByDate.get(selected) ?? [];
  const selectedLive = selectedTrips.filter((t) => t.status !== "cancelled");

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
    setBusy(true);
    try {
      const res = await fetch("/api/admin/trips", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...form, departureDate: selected }),
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
      const trip = selectedTrips.find((t) => t.id === tripId);
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
    dialog && dialog.type !== "addDeparture" ? selectedTrips.find((t) => t.id === dialog.tripId) ?? null : null;

  const seatsBooked = selectedLive.reduce((s, t) => s + t.ticketsSold, 0);
  const seatsTotal = selectedLive.reduce((s, t) => s + t.capacity, 0);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <h1 className="text-title-page">{monthLabel(cursor)}</h1>
        <div className="flex gap-2 max-md:w-full">
          <Button
            variant="secondary"
            size="dock"
            icon={<ChevronLeftIcon size={18} />}
            aria-label="Prev month"
            className="max-md:flex-1 px-3.5"
            onClick={() => setCursor(shiftMonth(cursor, -1))}
          >
            Prev
          </Button>
          <Button
            variant="secondary"
            size="dock"
            className="max-md:flex-1"
            onClick={() => {
              setCursor(today.slice(0, 7));
              setSelected(today);
            }}
          >
            Today
          </Button>
          <Button
            variant="secondary"
            size="dock"
            iconAfter={<ChevronRightIcon size={18} />}
            aria-label="Next month"
            className="max-md:flex-1 px-3.5"
            onClick={() => setCursor(shiftMonth(cursor, 1))}
          >
            Next
          </Button>
        </div>
      </div>

      {error ? (
        <ErrorState onRetry={load} body={<>Your trips are safe — this screen just can&rsquo;t load them right now.</>} />
      ) : (
        <>
          <MonthGrid
            label={monthLabel(cursor)}
            dates={gridDates}
            cursor={cursor}
            today={today}
            selected={selected}
            tripsByDate={tripsByDate}
            onPick={setSelected}
          />
          <div className="flex flex-wrap gap-x-5 gap-y-2 text-meta text-ob-ink-2">
            <span className="inline-flex items-center gap-2">
              <Lamp tone="alert" size={10} />A trip was cancelled
            </span>
            <span className="inline-flex items-center gap-2">
              <Lamp tone="ink" shape="dashed" size={10} />
              One-off departure added
            </span>
            <span className="inline-flex items-center gap-2">
              <span aria-hidden="true" className="w-[18px] h-1 bg-ob-ink-2" />
              How full the day is
            </span>
          </div>

          <Panel aria-labelledby="day-h">
            <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3 px-5 py-4 border-b-2 border-ob-rule max-md:px-4">
              <div className="flex flex-col gap-0.5">
                <h2 id="day-h" className="text-title-panel">
                  {fmtLongDateET(selected)}
                </h2>
                {trips && (
                  <div className="text-body-sm text-ob-ink-2">
                    {selectedLive.length} going out · {seatsBooked} of {seatsTotal} seats booked
                  </div>
                )}
              </div>
              <Button
                variant="key"
                size="dock"
                icon={<PlusIcon />}
                className="max-md:w-full"
                onClick={() => setDialog({ type: "addDeparture" })}
              >
                Add a departure for this day
              </Button>
            </div>
            {!trips ? (
              <LoadingState label="Loading this day’s trips…" />
            ) : selectedTrips.length === 0 ? (
              <EmptyState
                title="Nothing going out this day."
                body={<>Either it isn&rsquo;t in your weekly schedule, or every trip was cancelled.</>}
              />
            ) : (
              <TripList trips={selectedTrips} actions={actions} />
            )}
          </Panel>
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
        dateLabel={fmtLongMonthDayET(selected)}
        onClose={() => setDialog(null)}
        onConfirm={submitAddDeparture}
      />
    </div>
  );
}

/** The fill bar follows the trip-light colours: past days ink-3, full go, 70%+ caution, else ink-2. */
function dayFill(ratio: number, dim: boolean): string {
  if (dim) return "bg-ob-ink-3";
  if (ratio >= 1) return "bg-ob-go";
  if (ratio >= 0.7) return "bg-ob-caution";
  return "bg-ob-ink-2";
}

function MonthGrid({
  label,
  dates,
  cursor,
  today,
  selected,
  tripsByDate,
  onPick,
}: {
  label: string;
  dates: string[];
  cursor: string;
  today: string;
  selected: string;
  tripsByDate: Map<string, TripRowData[]>;
  onPick: (date: string) => void;
}) {
  return (
    <div className="bg-ob-panel border-2 border-ob-rule rounded-ob overflow-hidden">
      <div aria-hidden="true" className="grid grid-cols-7 border-b-2 border-ob-rule bg-ob-panel-2">
        {WEEKDAY_HEADERS.map((d) => (
          <div key={d} className="py-2 px-2.5 max-md:px-1 text-meta font-bold text-ob-ink-2">
            <span className="max-md:hidden">{d}</span>
            <span className="md:hidden">{d.charAt(0)}</span>
          </div>
        ))}
      </div>
      <div role="group" aria-label={label} className="grid grid-cols-7">
        {dates.map((date, i) => {
          const dayTrips = tripsByDate.get(date) ?? [];
          const live = dayTrips.filter((t) => t.status !== "cancelled").sort((a, b) => a.startTime.localeCompare(b.startTime));
          const sold = live.reduce((s, t) => s + t.ticketsSold, 0);
          const cap = live.reduce((s, t) => s + t.capacity, 0);
          const ratio = cap ? sold / cap : 0;
          const pct = Math.min(100, Math.round(ratio * 100));
          const inMonth = date.slice(0, 7) === cursor;
          const past = date < today;
          // Days outside the month and days gone by are dimmed with ink-3, not
          // opacity, so their text keeps AA contrast.
          const dim = past || !inMonth;
          const isToday = date === today;
          const isSelected = date === selected;
          const cancelled = dayTrips.some((t) => t.status === "cancelled");
          const added = dayTrips.some((t) => t.scheduleId === null);
          // Accessible name = "Saturday, October" + the visible day number + a
          // spoken summary; the chips, count and bar are decorative repeats.
          const [weekday, monthDay] = fmtLongDateET(date).split(", ");
          const spoken =
            ": " +
            (live.length ? `${live.length} going out, ${sold} of ${cap} booked` : "nothing going out") +
            (cancelled ? ", a trip was cancelled" : "") +
            (added ? ", a one-off departure was added" : "");
          return (
            <button
              key={date}
              type="button"
              aria-pressed={isSelected}
              onClick={() => onPick(date)}
              className={`relative flex flex-col items-stretch gap-1 min-h-[148px] max-md:min-h-16 py-2 px-2.5 max-md:py-1.5 max-md:px-1 text-left text-ob-ink border-b border-ob-hair ${
                i % 7 === 6 ? "" : "border-r"
              } ${isSelected ? "bg-ob-panel-2 shadow-[inset_0_0_0_3px_var(--ob-ink)]" : "hover:bg-ob-panel-2"}`}
            >
              <div className="flex items-center justify-between gap-1">
                <span className="sr-only">{`${weekday}, ${monthDay.replace(/\s*\d+$/, "")} `}</span>
                <span
                  className={`inline-flex items-center justify-center min-w-7 h-[26px] px-1 font-num text-body font-semibold rounded-lamp ${
                    isToday ? "bg-ob-key text-ob-key-ink" : dim ? "text-ob-ink-3" : "text-ob-ink"
                  }`}
                >
                  {Number(date.slice(-2))}
                </span>
                <span className="sr-only">{spoken}</span>
                {cancelled ? (
                  <Lamp tone="alert" size={10} />
                ) : added ? (
                  <Lamp tone="ink" shape="dashed" size={10} />
                ) : null}
              </div>
              <div aria-hidden="true" className="max-md:hidden flex flex-col gap-1">
                {live.slice(0, 3).map((t) => (
                  <div
                    key={t.id}
                    className={`flex items-center gap-1.5 text-meta leading-tight whitespace-nowrap overflow-hidden ${dim ? "text-ob-ink-3" : "text-ob-ink"}`}
                  >
                    <span aria-hidden="true" className="w-2.5 h-1 flex-none" style={{ backgroundColor: t.vessel.color }} />
                    <span className="font-num">{fmtTimeCompactET(t.startTime)}</span>
                    <span className="truncate">{t.vessel.name}</span>
                  </div>
                ))}
                {live.length > 3 && <div className="text-meta text-ob-ink-3">+{live.length - 3} more</div>}
              </div>
              {live.length > 0 && (
                <div aria-hidden="true" className="md:hidden font-num text-meta text-ob-ink-2">
                  {live.length}
                </div>
              )}
              {live.length > 0 && (
                <div aria-hidden="true" className="mt-auto flex items-center gap-1.5">
                  <div className="flex-1 h-1 bg-ob-panel-2 shadow-[inset_0_0_0_1px_var(--ob-hair)]">
                    <div className={`h-full ${dayFill(ratio, dim)}`} style={{ width: `${pct}%` }} />
                  </div>
                  <span className="max-md:hidden font-num text-meta text-ob-ink-3">{pct}%</span>
                </div>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

