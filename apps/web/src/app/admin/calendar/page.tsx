"use client";

import { useEffect, useMemo, useState, useCallback } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { fmtTimeCompactET, fmtLongDateET, fmtLongMonthDayET } from "@/lib/format";
import { todayET } from "@/lib/date-et";
import {
  Card,
  Button,
  TripList,
  useToast,
  CancelDialog,
  SeatsDialog,
  AddDepartureDialog,
  type TripRowData,
  type ProductOption,
} from "@/components/admin/merchant";

type DialogState =
  | { type: "cancel"; tripId: string }
  | { type: "seats"; tripId: string; currentCapacity: number }
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
        showToast(body.error ?? "Couldn't cancel the trip.");
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

  async function submitSeats(tripId: string, capacity: number) {
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/trips/${tripId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ capacity }),
      });
      const body = await res.json();
      if (!res.ok) {
        showToast(body.error ?? "Couldn't update seats.");
        return;
      }
      showToast(`Seats updated — ${capacity} total.`);
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
        showToast(body.error ?? "Couldn't add the departure.");
        return;
      }
      showToast("Departure added.");
      setDialog(null);
      await refreshAfterAction();
    } finally {
      setBusy(false);
    }
  }

  if (error) {
    return (
      <div className="rounded-xl border border-merchant-red-tint bg-[#fff8f7] p-5">
        <div className="text-14 font-semibold text-merchant-red">Can&rsquo;t reach the booking system</div>
        <p className="mt-1 text-13 text-merchant-muted">
          Your trips are safe — this screen just can&rsquo;t load them right now.
        </p>
        <Button variant="secondary" className="mt-3" onClick={load}>
          Try again
        </Button>
      </div>
    );
  }

  const actions = {
    onWhosComing: (tripId: string) => router.push(`/admin/trips/${tripId}/passengers`),
    onSeats: (tripId: string) => {
      const trip = selectedTrips.find((t) => t.id === tripId);
      if (trip) setDialog({ type: "seats", tripId, currentCapacity: trip.capacity });
    },
    onCancel: (tripId: string) => setDialog({ type: "cancel", tripId }),
  };

  const seatsBooked = selectedLive.reduce((s, t) => s + t.ticketsSold, 0);
  const seatsTotal = selectedLive.reduce((s, t) => s + t.capacity, 0);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-20 font-bold text-merchant-ink" style={{ letterSpacing: "-0.01em" }}>
          {monthLabel(cursor)}
        </h1>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={() => setCursor(shiftMonth(cursor, -1))}>
            ← Prev
          </Button>
          <Button
            variant="secondary"
            onClick={() => {
              setCursor(today.slice(0, 7));
              setSelected(today);
            }}
          >
            Today
          </Button>
          <Button variant="secondary" onClick={() => setCursor(shiftMonth(cursor, 1))}>
            Next →
          </Button>
        </div>
      </div>

      <Card>
        <div className="grid grid-cols-7">
          {WEEKDAY_HEADERS.map((d) => (
            <div key={d} className="text-12 font-semibold text-merchant-muted text-center py-2 border-b border-merchant-hairline">
              {d}
            </div>
          ))}
          {gridDates.map((date) => {
            const dayTrips = tripsByDate.get(date) ?? [];
            const liveDayTrips = dayTrips.filter((t) => t.status !== "cancelled");
            const inMonth = date.slice(0, 7) === cursor;
            const isToday = date === today;
            const isSelected = date === selected;
            const hasFlag = dayTrips.some((t) => t.status === "cancelled" || t.scheduleId === null);
            const dayNum = Number(date.slice(-2));
            return (
              <button
                key={date}
                onClick={() => setSelected(date)}
                className={`min-h-[92px] p-1.5 text-left border-b border-r border-merchant-hairline last:border-r-0 [&:nth-child(7n)]:border-r-0 ${
                  isSelected ? "bg-merchant-fill-2" : "bg-white hover:bg-merchant-fill"
                } ${!inMonth ? "opacity-40" : ""}`}
                style={isSelected ? { boxShadow: "inset 0 0 0 2px #303030" } : isToday ? { boxShadow: "inset 0 0 0 1px #005bd3" } : undefined}
              >
                <div className="flex items-center justify-between">
                  <span className={`text-13 font-semibold tabular-nums ${isToday ? "text-merchant-blue" : "text-merchant-ink"}`}>
                    {dayNum}
                  </span>
                  {hasFlag && <span className="w-1.5 h-1.5 rounded-full bg-merchant-amber" />}
                </div>
                <div className="flex flex-col gap-0.5 mt-1">
                  {liveDayTrips.slice(0, 3).map((t) => (
                    <div key={t.id} className="text-11 bg-merchant-fill-3 rounded-[6px] px-1 py-0.5 truncate">
                      {fmtTimeCompactET(t.startTime)} {t.vessel.name}
                    </div>
                  ))}
                  {liveDayTrips.length > 3 && (
                    <div className="text-11 text-merchant-faint px-1">+{liveDayTrips.length - 3} more</div>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      </Card>

      <Card>
        <div className="px-4 py-3.5 flex flex-wrap items-center justify-between gap-3 border-b border-merchant-hairline">
          <div>
            <div className="text-15 font-bold text-merchant-ink">{fmtLongDateET(selected)}</div>
            <div className="text-13 text-merchant-muted">
              {selectedLive.length} going out · {seatsBooked} of {seatsTotal} seats booked
            </div>
          </div>
          <Button variant="secondary" onClick={() => setDialog({ type: "addDeparture" })}>
            Add a departure for this day
          </Button>
        </div>
        {selectedTrips.length === 0 ? (
          <div className="px-4 py-8 text-center">
            <div className="text-14 font-semibold text-merchant-ink">Nothing going out this day.</div>
            <div className="text-13 text-merchant-muted mt-1">
              Either it isn&rsquo;t in your weekly schedule, or every trip was cancelled.
            </div>
          </div>
        ) : (
          <TripList trips={selectedTrips} actions={actions} />
        )}
      </Card>

      <CancelDialog
        open={dialog?.type === "cancel"}
        busy={busy}
        onClose={() => setDialog(null)}
        onConfirm={(reason) => dialog?.type === "cancel" && submitCancel(dialog.tripId, reason)}
      />
      <SeatsDialog
        open={dialog?.type === "seats"}
        busy={busy}
        currentCapacity={dialog?.type === "seats" ? dialog.currentCapacity : 0}
        onClose={() => setDialog(null)}
        onConfirm={(capacity) => dialog?.type === "seats" && submitSeats(dialog.tripId, capacity)}
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
