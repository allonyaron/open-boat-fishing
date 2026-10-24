"use client";

import { useEffect, useState, useCallback } from "react";
import { fmtLongMonthDayET } from "@/lib/format";
import { VALID_DAYS, type DayOfWeek } from "@/lib/trip-materialization";
import {
  Panel,
  Button,
  StatusLight,
  useDensity,
  useToast,
  ScheduleDialog,
  ErrorState,
  EmptyState,
  LoadingState,
  PlusIcon,
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

const DAY_NAMES: Record<DayOfWeek, string> = {
  mon: "Monday",
  tue: "Tuesday",
  wed: "Wednesday",
  thu: "Thursday",
  fri: "Friday",
  sat: "Saturday",
  sun: "Sunday",
};

/** schedules.departureTime/returnTime are plain "HH:MM:SS" strings, not timestamps. */
function fmt12FromTimeString(t: string): string {
  const [h, m] = t.split(":").map(Number);
  const ampm = h >= 12 ? "PM" : "AM";
  const hr = h % 12 || 12;
  return `${hr}:${String(m).padStart(2, "0")} ${ampm}`;
}

/** "Nov 28". dateStr is YYYY-MM-DD. */
function fmtShortMonthDay(dateStr: string): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export default function WeeklySchedulePage() {
  const { showToast } = useToast();
  const { density } = useDensity();
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
        showToast(body.error ?? "Couldn't update the pattern.", "error");
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
        showToast(body.error ?? "Couldn't save the schedule.", "error");
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

  const running = (schedules ?? []).filter((s) => s.active);
  const seasonEnd = running.reduce<string | null>((max, s) => (!max || s.endDate > max ? s.endDate : max), null);

  // Group by boat, boats in the order they first appear.
  const groups: { vessel: Schedule["vessel"]; items: Schedule[] }[] = [];
  for (const s of schedules ?? []) {
    let g = groups.find((x) => x.vessel.id === s.vessel.id);
    if (!g) groups.push((g = { vessel: s.vessel, items: [] }));
    g.items.push(s);
  }

  const rowActions = {
    onChange: (s: Schedule) => setDialogSchedule(s),
    onPause: togglePause,
    pausingId,
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-title-page">Weekly schedule</h1>
          {schedules && schedules.length > 0 && (
            <div className="text-body text-ob-ink-2 mt-1">
              {plural(running.length, "pattern", "patterns")} running
              {seasonEnd ? ` · season through ${fmtLongMonthDayET(seasonEnd)}` : ""}
            </div>
          )}
        </div>
        <Button
          variant="key"
          size="dock"
          icon={<PlusIcon />}
          className="max-md:w-full"
          onClick={() => setDialogSchedule("new")}
          disabled={products.length === 0}
        >
          New pattern
        </Button>
      </div>

      {error ? (
        <ErrorState onRetry={load} body={<>Your schedules just can&rsquo;t load right now.</>} />
      ) : !schedules ? (
        <Panel>
          <LoadingState variant="blocks" rows={3} label="Loading your weekly schedule…" />
        </Panel>
      ) : schedules.length === 0 ? (
        <Panel>
          <EmptyState
            title="No patterns yet."
            body={
              products.length === 0
                ? "Add a trip type in Settings first, then set up your weekly schedule."
                : "Set your normal week once — it fills the calendar for the season."
            }
          />
        </Panel>
      ) : density === "dock" ? (
        <div className="flex flex-col gap-5">
          {groups.map((g) => {
            const live = g.items.filter((s) => s.active).length;
            const paused = g.items.length - live;
            return (
              <Panel key={g.vessel.id} aria-labelledby={`boat-${g.vessel.id}`}>
                <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 px-5 py-3 border-b-2 border-ob-rule max-md:px-4">
                  <span aria-hidden="true" className="w-5 h-[5px]" style={{ backgroundColor: g.vessel.color }} />
                  <h2 id={`boat-${g.vessel.id}`} className="text-18 font-extrabold">
                    {g.vessel.name}
                  </h2>
                  <span className="text-body-sm text-ob-ink-2">
                    {live} running{paused ? ` · ${paused} paused` : ""}
                  </span>
                </div>
                {g.items.map((s) => (
                  <PatternRowDock key={s.id} s={s} actions={rowActions} />
                ))}
              </Panel>
            );
          })}
        </div>
      ) : (
        <PatternTableDesk schedules={groups.flatMap((g) => g.items)} actions={rowActions} />
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

type RowActions = {
  onChange: (s: Schedule) => void;
  onPause: (s: Schedule) => void;
  pausingId: string | null;
};

/** Mo–Su strip. On = key-filled (ink-3-filled when paused); off = hair outline. */
function DayStrip({ s, size }: { s: Schedule; size: "lg" | "sm" }) {
  const on = VALID_DAYS.filter((d) => s.daysOfWeek.includes(d));
  return (
    <span
      role="img"
      aria-label={on.length ? `Runs ${on.map((d) => DAY_NAMES[d]).join(", ")}` : "No days picked"}
      className={`flex ${size === "lg" ? "gap-1" : "gap-0.5"}`}
    >
      {VALID_DAYS.map((d) => {
        const isOn = s.daysOfWeek.includes(d);
        return (
          <span
            key={d}
            aria-hidden="true"
            className={`flex items-center justify-center font-bold rounded-lamp ${
              size === "lg" ? "w-11 h-10 max-md:w-10 text-meta border-2" : "w-6 h-6 text-meta border"
            } ${
              isOn
                ? s.active
                  ? "bg-ob-key text-ob-key-ink border-ob-key"
                  : "bg-ob-ink-3 text-ob-key-ink border-ob-ink-3"
                : "text-ob-ink-3 border-ob-hair"
            }`}
          >
            {size === "lg" ? DAY_LABELS[d] : DAY_LABELS[d].charAt(0)}
          </span>
        );
      })}
    </span>
  );
}

function PatternButtons({ s, actions, className = "" }: { s: Schedule; actions: RowActions; className?: string }) {
  return (
    <>
      <Button variant="secondary" className={className} onClick={() => actions.onChange(s)}>
        Change
      </Button>
      <Button
        variant={s.active ? "secondary" : "strong"}
        className={className}
        disabled={actions.pausingId === s.id}
        onClick={() => actions.onPause(s)}
      >
        {s.active ? "Pause" : "Turn back on"}
      </Button>
    </>
  );
}

function PatternRowDock({ s, actions }: { s: Schedule; actions: RowActions }) {
  // Paused patterns are dimmed with ink tokens, not opacity, so they keep AA contrast.
  const mono = s.active ? "font-num text-ob-ink" : "font-num";
  return (
    <div
      className={`flex flex-wrap items-center gap-x-6 gap-y-3.5 px-5 py-4 border-t border-ob-hair first:border-t-0 [&:nth-child(2)]:border-t-0 max-md:px-4 ${
        s.active ? "" : "text-ob-ink-2"
      }`}
    >
      <div className="flex-[1_1_320px] min-w-0 flex flex-col gap-2.5">
        <div className="flex flex-wrap items-center gap-x-3.5 gap-y-1.5">
          <span className={`text-title-row ${s.active ? "text-ob-ink" : "text-ob-ink-2"}`}>{s.product.displayName}</span>
          <StatusLight kind={s.active ? "running" : "paused"} />
        </div>
        <DayStrip s={s} size="lg" />
        <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-body-sm text-ob-ink-2 whitespace-nowrap">
          <span>
            <span className={mono}>{fmt12FromTimeString(s.departureTime)}</span> to{" "}
            <span className={mono}>{fmt12FromTimeString(s.returnTime)}</span>
          </span>
          <span>
            <span className={mono}>{s.capacity}</span> seats
          </span>
          <span>through {fmtLongMonthDayET(s.endDate)}</span>
          <span>
            <span className={mono}>{s.tripCount}</span> {s.tripCount === 1 ? "trip" : "trips"} on the calendar
          </span>
        </div>
      </div>
      <div className="flex gap-2.5 max-md:flex-[1_1_100%]">
        <PatternButtons s={s} actions={actions} className="flex-1" />
      </div>
    </div>
  );
}

const TH = "py-2.5 px-3 text-meta font-bold text-ob-ink-2 whitespace-nowrap";

function PatternTableDesk({ schedules, actions }: { schedules: Schedule[]; actions: RowActions }) {
  return (
    <div className="bg-ob-panel border-2 border-ob-rule rounded-ob overflow-x-auto">
      <table className="w-full min-w-[900px] border-collapse text-body-sm">
        <thead>
          <tr className="bg-ob-panel-2 text-left">
            <th scope="col" className={`${TH} pl-4`}>Boat</th>
            <th scope="col" className={TH}>Trip</th>
            <th scope="col" className={TH}>Days</th>
            <th scope="col" className={TH}>Leaves</th>
            <th scope="col" className={TH}>Back</th>
            <th scope="col" className={`${TH} text-right`}>Seats</th>
            <th scope="col" className={TH}>Through</th>
            <th scope="col" className={`${TH} text-right`}>Trips</th>
            <th scope="col" className={TH}>Status</th>
            <th scope="col" className={`${TH} pr-4 text-right`}>Change</th>
          </tr>
        </thead>
        <tbody>
          {schedules.map((s) => {
            const dim = s.active ? "" : "text-ob-ink-2";
            return (
              <tr key={s.id} className={`border-t border-ob-hair ${dim}`}>
                <td className="py-1.5 pl-4 pr-3 whitespace-nowrap">
                  <span className="inline-flex items-center gap-2">
                    <span aria-hidden="true" className="w-3.5 h-1" style={{ backgroundColor: s.vessel.color }} />
                    {s.vessel.name}
                  </span>
                </td>
                <td className="py-1.5 px-3 font-bold">{s.product.displayName}</td>
                <td className="py-1.5 px-3">
                  <DayStrip s={s} size="sm" />
                </td>
                <td className="py-1.5 px-3 font-num whitespace-nowrap">{fmt12FromTimeString(s.departureTime)}</td>
                <td className="py-1.5 px-3 font-num whitespace-nowrap text-ob-ink-2">{fmt12FromTimeString(s.returnTime)}</td>
                <td className="py-1.5 px-3 font-num text-right">{s.capacity}</td>
                <td className="py-1.5 px-3 whitespace-nowrap">{fmtShortMonthDay(s.endDate)}</td>
                <td className="py-1.5 px-3 font-num text-right">{s.tripCount}</td>
                <td className="py-1.5 px-3 whitespace-nowrap">
                  <StatusLight kind={s.active ? "running" : "paused"} dense />
                </td>
                <td className="py-1.5 pl-3 pr-4 text-right whitespace-nowrap">
                  <span className="inline-flex gap-1.5">
                    <PatternButtons s={s} actions={actions} />
                  </span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
