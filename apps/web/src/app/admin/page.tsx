"use client";

import { useEffect, useMemo, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { dollars } from "@openboat/utils";
import { fmtTimeCompactET, fmtDayLabelET } from "@/lib/format";
import {
  Card,
  CardHeader,
  CardRow,
  Button,
  Input,
  Label,
  Select,
  Dialog,
  TripList,
  useToast,
  type TripRowData,
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

type ProductOption = { id: string; displayName: string; vessel: { name: string } };

type DialogState =
  | { type: "cancel"; tripId: string }
  | { type: "seats"; tripId: string; currentCapacity: number }
  | { type: "addDeparture" }
  | null;

const CANCEL_REASONS = [
  { value: "weather", label: "Weather — it isn't safe to go out" },
  { value: "mechanical", label: "Engine or boat trouble" },
  { value: "low_bookings", label: "Not enough people booked" },
];

function fmtLongDateET(dateStr: string): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  });
}

function fmtLongMonthDayET(dateStr: string): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  });
}

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
      .then(setProducts)
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
          Your trips are safe — this screen just can&rsquo;t load them right now. Customers may not be able to book
          until it&rsquo;s back.
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
      const trip = todayTrips.find((t) => t.id === tripId);
      if (trip) setDialog({ type: "seats", tripId, currentCapacity: trip.capacity });
    },
    onCancel: (tripId: string) => setDialog({ type: "cancel", tripId }),
  };

  return (
    <div className="grid grid-cols-1 min-[1100px]:grid-cols-[minmax(0,1fr)_320px] gap-4 items-start">
      <div className="flex flex-col gap-4 min-w-0">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-20 font-bold text-merchant-ink" style={{ letterSpacing: "-0.01em" }}>
              Today
            </h1>
            <div className="text-13 text-merchant-muted">{data ? fmtLongDateET(data.today) : ""}</div>
          </div>
          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => setDialog({ type: "addDeparture" })} disabled={!data}>
              Add a departure
            </Button>
            <Button variant="primary" disabled title="Calendar lands in a later phase">
              Open the calendar
            </Button>
          </div>
        </div>

        {data && (
          <Alerts
            alerts={data.alerts}
            dismissed={dismissed}
            onDismiss={(key) => setDismissed((prev) => new Set(prev).add(key))}
            onOpenReport={(tripId) => router.push(`/admin/trips/${tripId}`)}
          />
        )}

        <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))" }}>
          <StatCard label="Trips going out" value={data ? String(data.stats.tripsGoingOut) : "—"} />
          <StatCard label="People booked" value={data ? String(data.stats.peopleBooked) : "—"} />
          <StatCard label="Seats still for sale" value={data ? String(data.stats.seatsForSale) : "—"} />
          <StatCard label="Taken in today" value={data ? dollars(data.stats.takenInTodayCents) : "—"} />
        </div>

        <Card>
          <CardHeader title="Today's departures" />
          {!data ? (
            <DeparturesSkeleton />
          ) : todayTrips.length === 0 ? (
            <CardRow className="text-center py-8">
              <div className="text-14 font-semibold text-merchant-ink">Nothing is going out today.</div>
              <div className="text-13 text-merchant-muted mt-1">
                Either today isn&rsquo;t in your weekly schedule, or every trip was cancelled.
              </div>
              <Button variant="secondary" className="mt-3" onClick={() => setDialog({ type: "addDeparture" })}>
                Add a departure
              </Button>
            </CardRow>
          ) : (
            <TripList trips={todayTrips} actions={actions} />
          )}
        </Card>

        <Card>
          <CardHeader title="Coming up" />
          {upcomingDays.length === 0 ? (
            <CardRow className="text-13 text-merchant-muted">Nothing on the calendar in the next few days.</CardRow>
          ) : (
            upcomingDays.map((day) => (
              <CardRow
                key={day.date}
                className="flex items-center justify-between gap-3 cursor-pointer hover:bg-merchant-fill"
                onClick={() => showToast("Calendar lands in a later phase.")}
              >
                <div>
                  <div className="text-14 font-semibold text-merchant-ink">{day.label}</div>
                  <div className="text-13 text-merchant-muted">{day.summary}</div>
                </div>
                <div className="text-13 text-merchant-muted tabular-nums flex-shrink-0">
                  {day.ticketsSold} of {day.capacity}
                </div>
              </CardRow>
            ))
          )}
        </Card>
      </div>

      <div className="hidden min-[1100px]:block">
        <PhonePreview trips={todayTrips} actions={actions} />
      </div>

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
        dateLabel={data ? fmtLongMonthDayET(data.today) : ""}
        onClose={() => setDialog(null)}
        onConfirm={submitAddDeparture}
      />
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <Card>
      <div className="p-3.5">
        <div className="text-13 text-merchant-muted">{label}</div>
        <div className="text-22 font-bold text-merchant-ink tabular-nums mt-0.5">{value}</div>
      </div>
    </Card>
  );
}

function DeparturesSkeleton() {
  return (
    <div className="px-4 py-3.5 flex flex-col gap-4">
      {[0, 1, 2].map((i) => (
        <div key={i} className="flex flex-col gap-2">
          <div className="h-3 w-1/3 rounded-md bg-[#ececec]" />
          <div className="h-2.5 w-2/3 rounded-md bg-[#f4f4f4]" />
        </div>
      ))}
    </div>
  );
}

function Alerts({
  alerts,
  dismissed,
  onDismiss,
  onOpenReport,
}: {
  alerts: TodayResponse["alerts"];
  dismissed: Set<string>;
  onDismiss: (key: string) => void;
  onOpenReport: (tripId: string) => void;
}) {
  // Design spec also has a weather alert (fires when a trip departs >=17:00,
  // fixed "small craft advisory" copy). Dropped for now — no real weather
  // data source exists, and firing that copy off departure time alone would
  // show captains false safety information on days with normal weather.
  const items: { key: string; accent: string; title: string; body: string; cta?: () => void; ctaLabel?: string }[] = [];

  if (alerts.seasonEnd && !dismissed.has("season-end")) {
    items.push({
      key: "season-end",
      accent: "#005bd3",
      title: "Your schedule is running out",
      body: `Your schedule runs out ${fmtLongMonthDayET(alerts.seasonEnd.date)} — nothing is on the calendar after that, so customers can't book past it.`,
      ctaLabel: "Weekly schedule",
      cta: () => {
        window.location.href = "/admin/settings/schedules";
      },
    });
  }
  if (alerts.reportsOwed && !dismissed.has("reports-owed")) {
    items.push({
      key: "reports-owed",
      accent: "#0c5132",
      title: "Reports owed",
      body: `${alerts.reportsOwed.count} trip${alerts.reportsOwed.count === 1 ? "" : "s"} still need${alerts.reportsOwed.count === 1 ? "s" : ""} a report.`,
      ctaLabel: "Post the report",
      cta: () => alerts.reportsOwed?.oldestTripId && onOpenReport(alerts.reportsOwed.oldestTripId),
    });
  }

  if (items.length === 0) return null;

  return (
    <div className="flex flex-col gap-2">
      {items.map((item) => (
        <div
          key={item.key}
          className="flex items-start gap-3 rounded-xl bg-white border border-merchant-hairline pl-3 pr-4 py-3"
          style={{ borderLeft: `4px solid ${item.accent}` }}
        >
          <div className="flex-1 min-w-0">
            <div className="text-14 font-semibold text-merchant-ink">{item.title}</div>
            <div className="text-13 text-merchant-muted mt-0.5">{item.body}</div>
            {item.cta && (
              <button onClick={item.cta} className="text-13 font-semibold text-merchant-blue mt-1.5 hover:underline">
                {item.ctaLabel}
              </button>
            )}
          </div>
          <button
            onClick={() => onDismiss(item.key)}
            aria-label="Dismiss"
            className="text-merchant-faint hover:text-merchant-ink text-base leading-none flex-shrink-0"
          >
            ×
          </button>
        </div>
      ))}
    </div>
  );
}

function PhonePreview({ trips, actions }: { trips: TripRowData[]; actions: Parameters<typeof TripList>[0]["actions"] }) {
  const live = trips.filter((t) => t.status !== "cancelled");
  return (
    <div className="rounded-2xl border border-merchant-hairline bg-white p-3 sticky top-[76px]">
      <div className="text-12 font-semibold text-merchant-faint text-center mb-2">Captain&rsquo;s phone view</div>
      <div className="flex flex-col gap-2.5">
        {live.length === 0 && <div className="text-13 text-merchant-muted text-center py-6">Nothing going out today.</div>}
        {live.map((t) => (
          <div key={t.id} className="rounded-xl border border-merchant-hairline p-3">
            <div className="text-15 font-bold text-merchant-ink">{fmtTimeCompactET(t.startTime)}</div>
            <div className="text-13 text-merchant-muted">
              {t.product.displayName} · {t.vessel.name}
            </div>
            <div className="text-13 text-merchant-muted mt-0.5">
              {t.ticketsSold} of {t.capacity} booked
            </div>
            <button
              onClick={() => actions.onWhosComing(t.id)}
              style={{ minHeight: "46px" }}
              className="mt-2 w-full rounded-lg bg-merchant-chrome-mid text-white text-13 font-semibold"
            >
              Who&rsquo;s coming
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

function CancelDialog({
  open,
  busy,
  onClose,
  onConfirm,
}: {
  open: boolean;
  busy: boolean;
  onClose: () => void;
  onConfirm: (reason: string) => void;
}) {
  const [reason, setReason] = useState(CANCEL_REASONS[0].value);
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Cancel trip"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Keep the trip
          </Button>
          <Button variant="destructive" onClick={() => onConfirm(reason)} disabled={busy}>
            Cancel and refund
          </Button>
        </>
      }
    >
      <Label htmlFor="cancel-reason">Reason</Label>
      <Select id="cancel-reason" value={reason} onChange={(e) => setReason(e.target.value)}>
        {CANCEL_REASONS.map((r) => (
          <option key={r.value} value={r.value}>
            {r.label}
          </option>
        ))}
      </Select>
      <div className="mt-4 rounded-lg bg-merchant-amber-soft px-3 py-2.5 text-13 text-merchant-amber-deep">
        Everyone is refunded automatically and notified. If a customer booked this trip with another, only this trip
        is refunded. This cannot be undone.
      </div>
    </Dialog>
  );
}

function SeatsDialog({
  open,
  busy,
  currentCapacity,
  onClose,
  onConfirm,
}: {
  open: boolean;
  busy: boolean;
  currentCapacity: number;
  onClose: () => void;
  onConfirm: (capacity: number) => void;
}) {
  const [value, setValue] = useState(currentCapacity);
  useEffect(() => setValue(currentCapacity), [currentCapacity, open]);
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Seats on this trip"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant="primary" onClick={() => onConfirm(value)} disabled={busy || value < 1}>
            Save seats
          </Button>
        </>
      }
    >
      <Label htmlFor="seats">Seats</Label>
      <Input id="seats" type="number" min={1} value={value} onChange={(e) => setValue(Number(e.target.value))} />
      <p className="mt-2 text-13 text-merchant-muted">Just this one trip. Your weekly schedule stays as it is.</p>
    </Dialog>
  );
}

function AddDepartureDialog({
  open,
  busy,
  products,
  dateLabel,
  onClose,
  onConfirm,
}: {
  open: boolean;
  busy: boolean;
  products: ProductOption[];
  dateLabel: string;
  onClose: () => void;
  onConfirm: (form: { productId: string; departureTime: string; returnTime: string; capacity: number }) => void;
}) {
  const [productId, setProductId] = useState("");
  const [departureTime, setDepartureTime] = useState("07:00");
  const [returnTime, setReturnTime] = useState("12:00");
  const [capacity, setCapacity] = useState(20);

  useEffect(() => {
    if (open && products.length > 0 && !productId) setProductId(products[0].id);
  }, [open, products, productId]);

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Add a departure"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button
            variant="primary"
            disabled={busy || !productId}
            onClick={() => onConfirm({ productId, departureTime, returnTime, capacity })}
          >
            Add departure
          </Button>
        </>
      }
    >
      <p className="text-13 text-merchant-muted mb-3">
        Adding a one-off departure for {dateLabel}. Your weekly schedule won&rsquo;t change.
      </p>
      <div className="flex flex-col gap-3">
        <div>
          <Label htmlFor="trip-type">Trip type</Label>
          <Select id="trip-type" value={productId} onChange={(e) => setProductId(e.target.value)}>
            {products.map((p) => (
              <option key={p.id} value={p.id}>
                {p.displayName} · {p.vessel.name}
              </option>
            ))}
          </Select>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label htmlFor="leaves">Leaves</Label>
            <Input id="leaves" type="time" value={departureTime} onChange={(e) => setDepartureTime(e.target.value)} />
          </div>
          <div>
            <Label htmlFor="back">Back</Label>
            <Input id="back" type="time" value={returnTime} onChange={(e) => setReturnTime(e.target.value)} />
          </div>
        </div>
        <div>
          <Label htmlFor="add-capacity">Seats</Label>
          <Input
            id="add-capacity"
            type="number"
            min={1}
            value={capacity}
            onChange={(e) => setCapacity(Number(e.target.value))}
          />
        </div>
      </div>
    </Dialog>
  );
}
