"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

type DayOfWeek = "mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun";
const ALL_DAYS: DayOfWeek[] = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
const DAY_LABELS: Record<DayOfWeek, string> = { mon: "Mo", tue: "Tu", wed: "We", thu: "Th", fri: "Fr", sat: "Sa", sun: "Su" };

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
  tripsCreated?: number;
  product: { id: string; displayName: string; category: string };
  vessel: { id: string; name: string; color: string };
};

type Product = { id: string; displayName: string; category: string; vessel: { id: string; name: string } };

const inputCls = "w-full border border-hairline rounded-lg px-3 py-2 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-navy";

function fmtDate(d: string) {
  const [y, m, day] = d.split("-").map(Number);
  return new Date(y, m - 1, day).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function fmt12(time: string) {
  const [h, m] = time.split(":").map(Number);
  const ampm = h >= 12 ? "pm" : "am";
  const hr = h % 12 || 12;
  return `${hr}:${String(m).padStart(2, "0")} ${ampm} UTC`;
}

function ScheduleForm({
  products,
  onSave,
  onCancel,
}: {
  products: Product[];
  onSave: (data: Record<string, unknown>) => Promise<{ error?: string; tripsCreated?: number } | null>;
  onCancel: () => void;
}) {
  const [productId, setProductId] = useState(products[0]?.id ?? "");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [days, setDays] = useState<DayOfWeek[]>(["sat", "sun"]);
  const [departureTime, setDepartureTime] = useState("07:00");
  const [returnTime, setReturnTime] = useState("12:00");
  const [capacity, setCapacity] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<{ tripsCreated: number } | null>(null);

  function toggleDay(d: DayOfWeek) {
    setDays((cur) => cur.includes(d) ? cur.filter((x) => x !== d) : [...cur, d]);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (days.length === 0) { setError("Select at least one day"); return; }
    setSaving(true);
    setError("");
    const res = await onSave({ productId, startDate, endDate, daysOfWeek: days, departureTime, returnTime, capacity: Number(capacity) });
    setSaving(false);
    if (!res) return;
    if (res.error) { setError(res.error); return; }
    if (res.tripsCreated !== undefined) setResult({ tripsCreated: res.tripsCreated });
  }

  if (result) {
    return (
      <div className="bg-success-bg rounded-xl border border-success/20 p-6 text-center">
        <div className="w-10 h-10 rounded-full bg-success/10 flex items-center justify-center mx-auto mb-3">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="text-success"><polyline points="20 6 9 17 4 12"/></svg>
        </div>
        <div className="font-semibold text-success text-sm">Schedule created</div>
        <div className="text-sm text-success/70 mt-1">{result.tripsCreated} trips generated on the calendar</div>
        <button onClick={onCancel} className="mt-4 text-sm text-navy font-medium hover:underline">Done</button>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="bg-fill rounded-xl border border-hairline p-5 grid gap-4">
      <div>
        <label className="block text-sm font-medium text-ink mb-1">Trip type</label>
        <select className={inputCls} value={productId} onChange={(e) => setProductId(e.target.value)} required>
          {products.map((p) => (
            <option key={p.id} value={p.id}>{p.vessel.name} · {p.displayName}</option>
          ))}
        </select>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-ink mb-1">Start date</label>
          <input className={inputCls} type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} required />
        </div>
        <div>
          <label className="block text-sm font-medium text-ink mb-1">End date</label>
          <input className={inputCls} type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} required />
        </div>
      </div>

      <div>
        <div className="text-sm font-medium text-ink mb-2">Days of week</div>
        <div className="flex gap-2">
          {ALL_DAYS.map((d) => (
            <button
              key={d}
              type="button"
              onClick={() => toggleDay(d)}
              className={`w-9 h-9 rounded-lg text-sm font-semibold border transition-colors ${
                days.includes(d)
                  ? "bg-navy text-white border-navy"
                  : "bg-white text-muted border-hairline hover:border-navy/30"
              }`}
            >
              {DAY_LABELS[d]}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <div>
          <label className="block text-sm font-medium text-ink mb-1">Departure (UTC)</label>
          <input className={inputCls} type="time" value={departureTime} onChange={(e) => setDepartureTime(e.target.value)} required />
        </div>
        <div>
          <label className="block text-sm font-medium text-ink mb-1">Return (UTC)</label>
          <input className={inputCls} type="time" value={returnTime} onChange={(e) => setReturnTime(e.target.value)} required />
        </div>
        <div>
          <label className="block text-sm font-medium text-ink mb-1">Capacity</label>
          <input className={inputCls} type="number" min={1} value={capacity} onChange={(e) => setCapacity(e.target.value)} required />
        </div>
      </div>

      <p className="text-xs text-faint">
        Times are stored in UTC. Eastern Time is UTC−5 (winter) / UTC−4 (summer).
        A 7:00 AM ET departure = 12:00 UTC in winter, 11:00 UTC in summer.
      </p>

      {error && <p className="text-sm text-warning">{error}</p>}

      <div className="flex gap-3 justify-end">
        <button type="button" onClick={onCancel} className="border border-hairline text-ink px-4 py-2 rounded-lg text-sm hover:bg-white transition-colors">Cancel</button>
        <button type="submit" disabled={saving || days.length === 0} className="bg-navy text-white px-4 py-2 rounded-lg text-sm font-medium hover:opacity-90 disabled:opacity-50 transition-opacity">
          {saving ? "Creating…" : "Create schedule & generate trips"}
        </button>
      </div>
    </form>
  );
}

export default function SchedulesPage() {
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);

  async function load() {
    setLoading(true);
    const [sr, pr] = await Promise.all([
      fetch("/api/admin/settings/schedules").then((r) => r.json()),
      fetch("/api/admin/settings/products").then((r) => r.json()),
    ]);
    setSchedules(sr);
    setProducts(pr.filter((p: Product & { active: boolean }) => p.active));
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  async function addSchedule(data: Record<string, unknown>) {
    const res = await fetch("/api/admin/settings/schedules", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    const json = await res.json();
    if (!res.ok) return { error: json.error ?? "Failed to create schedule" };
    await load();
    return { tripsCreated: json.tripsCreated ?? 0 };
  }

  return (
    <div className="max-w-3xl mx-auto">
      <div className="flex items-center gap-2 mb-6">
        <Link href="/admin/settings" className="text-sm text-muted hover:text-ink transition-colors">Settings</Link>
        <span className="text-hairline">›</span>
        <h1 className="text-xl font-semibold text-ink">Schedules</h1>
      </div>

      {loading ? (
        <div className="text-center text-muted py-16 text-sm">Loading…</div>
      ) : (
        <div className="space-y-3">
          {schedules.map((s) => (
            <div key={s.id} className="bg-white rounded-xl border border-hairline px-5 py-4">
              <div className="flex items-start gap-3">
                <div className="w-1.5 h-8 rounded-full mt-0.5 flex-shrink-0" style={{ backgroundColor: s.vessel.color }} />
                <div className="flex-1 min-w-0">
                  <div className="font-semibold text-sm text-ink">{s.vessel.name} · {s.product.displayName}</div>
                  <div className="text-xs text-muted mt-1">
                    {fmtDate(s.startDate)} → {fmtDate(s.endDate)}
                  </div>
                  <div className="text-xs text-muted mt-0.5">
                    {ALL_DAYS.filter((d) => s.daysOfWeek.includes(d)).map((d) => DAY_LABELS[d]).join(" ")}
                    {" · "}
                    {fmt12(s.departureTime)} → {fmt12(s.returnTime)}
                    {" · "}
                    {s.capacity} seats
                  </div>
                </div>
                {!s.active && <span className="text-xs px-2 py-0.5 rounded-full bg-fill text-muted flex-shrink-0">Inactive</span>}
              </div>
            </div>
          ))}

          {schedules.length === 0 && !adding && (
            <div className="text-center text-muted py-12 text-sm">
              No schedules yet.{" "}
              {products.length === 0 && <span>Add a trip type first, then create a schedule.</span>}
            </div>
          )}

          {products.length > 0 && (
            adding ? (
              <ScheduleForm
                products={products}
                onSave={addSchedule}
                onCancel={() => { setAdding(false); }}
              />
            ) : (
              <button
                onClick={() => setAdding(true)}
                className="w-full border-2 border-dashed border-hairline rounded-xl py-4 text-sm text-muted hover:border-navy/30 hover:text-navy transition-colors"
              >
                + Add schedule
              </button>
            )
          )}
        </div>
      )}
    </div>
  );
}
