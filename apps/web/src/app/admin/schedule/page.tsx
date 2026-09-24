"use client";

import { useEffect, useState, useCallback } from "react";
import { fmtLongMonthDayET } from "@/lib/format";
import { VALID_DAYS, type DayOfWeek } from "@/lib/trip-materialization";
import {
  Card,
  Button,
  TextButton,
  useToast,
  ScheduleDialog,
  type ProductOption,
  type SchedulePatternInput,
} from "@/components/admin/merchant";

type Schedule = {
  id: string;
  productId: string;
  startDate: string;
  endDate: string;
  daysOfWeek: DayOfWeek[];
  departureTime: string;
  returnTime: string;
  capacity: number;
  active: boolean;
  tripCount: number;
  product: { id: string; displayName: string; category: string };
  vessel: { id: string; name: string; color: string };
};

const DAY_LABELS: Record<DayOfWeek, string> = {
  mon: "Mo",
  tue: "Tu",
  wed: "We",
  thu: "Th",
  fri: "Fr",
  sat: "Sa",
  sun: "Su",
};

/** schedules.departureTime/returnTime are plain "HH:MM:SS" strings, not timestamps. */
function fmt12FromTimeString(t: string): string {
  const [h, m] = t.split(":").map(Number);
  const ampm = h >= 12 ? "PM" : "AM";
  const hr = h % 12 || 12;
  return `${hr}:${String(m).padStart(2, "0")} ${ampm}`;
}

export default function WeeklySchedulePage() {
  const { showToast } = useToast();
  const [schedules, setSchedules] = useState<Schedule[] | null>(null);
  const [products, setProducts] = useState<ProductOption[]>([]);
  const [error, setError] = useState(false);
  const [dialogSchedule, setDialogSchedule] = useState<Schedule | "new" | null>(null);
  const [busy, setBusy] = useState(false);
  const [pausingId, setPausingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(false);
    try {
      const res = await fetch("/api/admin/settings/schedules");
      if (!res.ok) throw new Error("failed");
      setSchedules(await res.json());
    } catch {
      setError(true);
    }
  }, []);

  useEffect(() => {
    load();
    fetch("/api/admin/settings/products")
      .then((r) => (r.ok ? r.json() : []))
      .then((all) => setProducts(all.filter((p: ProductOption & { active: boolean }) => p.active)))
      .catch(() => {});
  }, [load]);

  async function togglePause(schedule: Schedule) {
    setPausingId(schedule.id);
    try {
      const res = await fetch(`/api/admin/settings/schedules/${schedule.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ active: !schedule.active }),
      });
      const body = await res.json();
      if (!res.ok) {
        showToast(body.error ?? "Couldn't update the pattern.");
        return;
      }
      showToast(
        schedule.active
          ? `Paused. New ${schedule.product.displayName} trips won't appear — anything already booked still sails.`
          : `Turned back on. ${body.tripsAdded} trip${body.tripsAdded === 1 ? "" : "s"} added to the calendar.`,
      );
      await load();
    } finally {
      setPausingId(null);
    }
  }

  async function submitSchedule(input: SchedulePatternInput) {
    setBusy(true);
    try {
      const isNew = dialogSchedule === "new";
      const url = isNew
        ? "/api/admin/settings/schedules"
        : `/api/admin/settings/schedules/${(dialogSchedule as Schedule).id}`;
      const res = await fetch(url, {
        method: isNew ? "POST" : "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(input),
      });
      const body = await res.json();
      if (!res.ok) {
        showToast(body.error ?? "Couldn't save the schedule.");
        return;
      }
      showToast(
        isNew
          ? `Schedule saved. ${body.tripsCreated} trips added to the calendar.`
          : "Schedule updated.",
      );
      setDialogSchedule(null);
      await load();
    } finally {
      setBusy(false);
    }
  }

  if (error) {
    return (
      <div className="rounded-xl border border-merchant-red-tint bg-[#fff8f7] p-5">
        <div className="text-14 font-semibold text-merchant-red">Can&rsquo;t reach the booking system</div>
        <p className="mt-1 text-13 text-merchant-muted">Your schedules just can&rsquo;t load right now.</p>
        <Button variant="secondary" className="mt-3" onClick={load}>
          Try again
        </Button>
      </div>
    );
  }

  const dialogInitial: SchedulePatternInput | undefined =
    dialogSchedule && dialogSchedule !== "new"
      ? {
          productId: dialogSchedule.productId,
          daysOfWeek: dialogSchedule.daysOfWeek,
          departureTime: dialogSchedule.departureTime.slice(0, 5),
          returnTime: dialogSchedule.returnTime.slice(0, 5),
          capacity: dialogSchedule.capacity,
          startDate: dialogSchedule.startDate,
          endDate: dialogSchedule.endDate,
        }
      : undefined;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-20 font-bold text-merchant-ink" style={{ letterSpacing: "-0.01em" }}>
          Weekly schedule
        </h1>
        <Button variant="primary" onClick={() => setDialogSchedule("new")} disabled={products.length === 0}>
          New pattern
        </Button>
      </div>

      {!schedules ? (
        <Card>
          <div className="px-4 py-8 text-center text-13 text-merchant-muted">Loading…</div>
        </Card>
      ) : schedules.length === 0 ? (
        <Card>
          <div className="px-4 py-8 text-center">
            <div className="text-14 font-semibold text-merchant-ink">No patterns yet.</div>
            <div className="text-13 text-merchant-muted mt-1">
              {products.length === 0
                ? "Add a trip type in Settings first, then set up your weekly schedule."
                : "Set your normal week once — it fills the calendar for the season."}
            </div>
          </div>
        </Card>
      ) : (
        <div className="flex flex-col gap-3">
          {schedules.map((s) => (
            <Card key={s.id} className={s.active ? "" : "opacity-50"}>
              <div className="px-4 py-3.5 flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span
                      className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                      style={{ backgroundColor: s.active ? s.vessel.color : "#b5b5b5" }}
                    />
                    <span className="text-14 font-bold text-merchant-ink">
                      {s.product.displayName} · {s.vessel.name}
                    </span>
                  </div>
                  <div className="flex gap-1 mt-2">
                    {VALID_DAYS.map((d) => {
                      const on = s.daysOfWeek.includes(d);
                      return (
                        <span
                          key={d}
                          className={`w-[38px] h-[38px] flex items-center justify-center rounded-lg text-12 font-semibold ${
                            !s.active
                              ? "bg-merchant-fill-3 text-merchant-disabled"
                              : on
                                ? "bg-merchant-chrome-mid text-white"
                                : "bg-merchant-fill-3 text-merchant-faint"
                          }`}
                        >
                          {DAY_LABELS[d]}
                        </span>
                      );
                    })}
                  </div>
                  <div className="text-13 text-merchant-muted mt-2">
                    {fmt12FromTimeString(s.departureTime)} to {fmt12FromTimeString(s.returnTime)} · {s.capacity} seats ·
                    through {fmtLongMonthDayET(s.endDate)} · {s.tripCount} trip{s.tripCount === 1 ? "" : "s"} on the
                    calendar
                  </div>
                </div>
                <div className="flex gap-3 flex-shrink-0">
                  <TextButton onClick={() => setDialogSchedule(s)}>Change</TextButton>
                  <TextButton disabled={pausingId === s.id} onClick={() => togglePause(s)}>
                    {s.active ? "Pause" : "Turn back on"}
                  </TextButton>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      <ScheduleDialog
        open={dialogSchedule !== null}
        busy={busy}
        products={products}
        initial={dialogInitial}
        onClose={() => setDialogSchedule(null)}
        onConfirm={submitSchedule}
      />
    </div>
  );
}
