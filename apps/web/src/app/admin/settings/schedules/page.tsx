"use client";

import { useEffect, useState } from "react";

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

const inputCls = "w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500";

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
      <div className="bg-green-50 rounded-xl border border-green-200 p-5 text-center">
        <div className="text-2xl mb-2">✅</div>
        <div className="font-medium text-green-800">Schedule created</div>
        <div className="text-sm text-green-700 mt-1">{result.tripsCreated} trips generated on the calendar</div>
        <button onClick={onCancel} className="mt-4 text-sm text-green-700 underline">Done</button>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="bg-gray-50 rounded-xl border border-gray-200 p-5 grid gap-4">
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Trip type</label>
        <select className={inputCls} value={productId} onChange={(e) => setProductId(e.target.value)} required>
          {products.map((p) => (
            <option key={p.id} value={p.id}>{p.vessel.name} · {p.displayName}</option>
          ))}
        </select>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Start date</label>
          <input className={inputCls} type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} required />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">End date</label>
          <input className={inputCls} type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} required />
        </div>
      </div>

      <div>
        <div className="text-sm font-medium text-gray-700 mb-2">Days of week</div>
        <div className="flex gap-2">
          {ALL_DAYS.map((d) => (
            <button
              key={d}
              type="button"
              onClick={() => toggleDay(d)}
              className={`w-9 h-9 rounded-lg text-sm font-medium border transition-colors ${
                days.includes(d)
                  ? "bg-blue-600 text-white border-blue-600"
                  : "bg-white text-gray-600 border-gray-300 hover:border-blue-300"
              }`}
            >
              {DAY_LABELS[d]}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Departure (UTC)</label>
          <input className={inputCls} type="time" value={departureTime} onChange={(e) => setDepartureTime(e.target.value)} required />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Return (UTC)</label>
          <input className={inputCls} type="time" value={returnTime} onChange={(e) => setReturnTime(e.target.value)} required />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Capacity</label>
          <input className={inputCls} type="number" min={1} value={capacity} onChange={(e) => setCapacity(e.target.value)} required />
        </div>
      </div>

      <p className="text-xs text-gray-400">
        Times are stored in UTC. Eastern Time is UTC−5 (winter) / UTC−4 (summer).
        A 7:00 AM ET departure = 12:00 UTC in winter, 11:00 UTC in summer.
      </p>

      {error && <p className="text-sm text-red-600">{error}</p>}

      <div className="flex gap-3 justify-end">
        <button type="button" onClick={onCancel} className="border border-gray-300 text-gray-700 px-4 py-2 rounded-lg text-sm hover:bg-gray-50">Cancel</button>
        <button type="submit" disabled={saving || days.length === 0} className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50">
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
      <div className="flex items-center gap-3 mb-6">
        <a href="/admin/settings" className="text-sm text-gray-400 hover:text-gray-600">Settings</a>
        <span className="text-gray-300">›</span>
        <h1 className="text-2xl font-semibold text-gray-900">Schedules</h1>
      </div>

      {loading ? (
        <div className="text-center text-gray-400 py-16">Loading…</div>
      ) : (
        <div className="space-y-3">
          {schedules.map((s) => (
            <div key={s.id} className="bg-white rounded-xl border border-gray-200 px-5 py-4">
              <div className="flex items-start gap-3">
                <div className="w-3 h-3 rounded-full mt-1 flex-shrink-0" style={{ backgroundColor: s.vessel.color }} />
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-gray-900">{s.vessel.name} · {s.product.displayName}</div>
                  <div className="text-sm text-gray-500 mt-1">
                    {fmtDate(s.startDate)} → {fmtDate(s.endDate)}
                  </div>
                  <div className="text-sm text-gray-500 mt-0.5">
                    {ALL_DAYS.filter((d) => s.daysOfWeek.includes(d)).map((d) => DAY_LABELS[d]).join(" ")}
                    {" · "}
                    {fmt12(s.departureTime)} → {fmt12(s.returnTime)}
                    {" · "}
                    {s.capacity} seats
                  </div>
                </div>
                {!s.active && <span className="text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-500">Inactive</span>}
              </div>
            </div>
          ))}

          {schedules.length === 0 && !adding && (
            <div className="text-center text-gray-400 py-12">
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
                className="w-full border-2 border-dashed border-gray-200 rounded-xl py-4 text-sm text-gray-400 hover:border-blue-300 hover:text-blue-500 transition-colors"
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
