"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

type Vessel = {
  id: string;
  name: string;
  slug: string;
  color: string;
  capacity: number;
  certificateCapacity: number | null;
  description: string | null;
  groupDiscountThreshold: number | null;
  groupDiscountPct: number | null;
  active: boolean;
};

const inputCls = "w-full border border-hairline rounded-lg px-3 py-2 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-navy";

const PRESET_COLORS = ["#1D4ED8", "#0891B2", "#059669", "#D97706", "#DC2626", "#7C3AED", "#DB2777", "#374151"];

function VesselForm({
  initial,
  onSave,
  onCancel,
}: {
  initial?: Partial<Vessel>;
  onSave: (data: Partial<Vessel>) => Promise<string | null>;
  onCancel: () => void;
}) {
  const [name, setName] = useState(initial?.name ?? "");
  const [color, setColor] = useState(initial?.color ?? PRESET_COLORS[0]);
  const [capacity, setCapacity] = useState(String(initial?.capacity ?? ""));
  const [description, setDescription] = useState(initial?.description ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError("");
    const err = await onSave({ name, color, capacity: Number(capacity), description: description || undefined });
    setSaving(false);
    if (err) setError(err);
  }

  return (
    <form onSubmit={submit} className="bg-fill rounded-xl border border-hairline p-5 grid gap-4">
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-ink mb-1">Vessel name</label>
          <input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} required placeholder="Blue Wave Express" />
        </div>
        <div>
          <label className="block text-sm font-medium text-ink mb-1">Capacity</label>
          <input className={inputCls} type="number" min={1} value={capacity} onChange={(e) => setCapacity(e.target.value)} required />
        </div>
      </div>

      <div>
        <label className="block text-sm font-medium text-ink mb-2">Color (for calendar display)</label>
        <div className="flex gap-2 flex-wrap">
          {PRESET_COLORS.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => setColor(c)}
              className="w-8 h-8 rounded-full border-2 transition-all"
              style={{
                backgroundColor: c,
                borderColor: color === c ? "#14233d" : "transparent",
                outline: color === c ? "2px solid #C9922A" : "none",
              }}
            />
          ))}
          <input
            type="color"
            value={color}
            onChange={(e) => setColor(e.target.value)}
            className="w-8 h-8 rounded-full border border-hairline cursor-pointer"
            title="Custom color"
          />
        </div>
      </div>

      <div>
        <label className="block text-sm font-medium text-ink mb-1">Description (optional)</label>
        <input className={inputCls} value={description} onChange={(e) => setDescription(e.target.value)} />
      </div>

      {error && <p className="text-sm text-warning">{error}</p>}

      <div className="flex gap-3 justify-end">
        <button type="button" onClick={onCancel} className="border border-hairline text-ink px-4 py-2 rounded-lg text-sm hover:bg-white transition-colors">
          Cancel
        </button>
        <button type="submit" disabled={saving} className="bg-navy text-white px-4 py-2 rounded-lg text-sm font-medium hover:opacity-90 disabled:opacity-50 transition-opacity">
          {saving ? "Saving…" : initial?.id ? "Save changes" : "Add vessel"}
        </button>
      </div>
    </form>
  );
}

export default function VesselsPage() {
  const [vessels, setVessels] = useState<Vessel[]>([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    const res = await fetch("/api/admin/settings/vessels");
    if (res.ok) setVessels(await res.json());
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  async function addVessel(data: Partial<Vessel>): Promise<string | null> {
    const res = await fetch("/api/admin/settings/vessels", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    const json = await res.json();
    if (!res.ok) return json.error ?? "Failed to add vessel";
    setAdding(false);
    await load();
    return null;
  }

  async function updateVessel(id: string, data: Partial<Vessel>): Promise<string | null> {
    const res = await fetch(`/api/admin/settings/vessels/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    const json = await res.json();
    if (!res.ok) return json.error ?? "Failed to update vessel";
    setEditing(null);
    await load();
    return null;
  }

  async function toggleActive(vessel: Vessel) {
    await fetch(`/api/admin/settings/vessels/${vessel.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ active: !vessel.active }),
    });
    await load();
  }

  return (
    <div className="max-w-3xl mx-auto">
      <div className="flex items-center gap-2 mb-6">
        <Link href="/admin/settings" className="text-sm text-muted hover:text-ink transition-colors">Settings</Link>
        <span className="text-hairline">›</span>
        <h1 className="text-xl font-semibold text-ink">Vessels</h1>
      </div>

      {loading ? (
        <div className="text-center text-muted py-16 text-sm">Loading…</div>
      ) : (
        <div className="space-y-3">
          {vessels.map((v) =>
            editing === v.id ? (
              <VesselForm
                key={v.id}
                initial={v}
                onSave={(data) => updateVessel(v.id, data)}
                onCancel={() => setEditing(null)}
              />
            ) : (
              <div key={v.id} className="bg-white rounded-xl border border-hairline px-5 py-4 flex items-center gap-4">
                <div className="w-1.5 h-10 rounded-full flex-shrink-0" style={{ backgroundColor: v.color }} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-sm text-ink">{v.name}</span>
                    {!v.active && (
                      <span className="text-xs px-2 py-0.5 rounded-full bg-fill text-muted">Inactive</span>
                    )}
                  </div>
                  <div className="text-xs text-muted mt-0.5">
                    Capacity: {v.capacity} · slug: <code className="bg-fill px-1 rounded text-xs">{v.slug}</code>
                  </div>
                </div>
                <div className="flex gap-1 flex-shrink-0">
                  <button
                    onClick={() => setEditing(v.id)}
                    className="text-sm font-medium text-navy hover:text-navy-light px-3 py-1.5 rounded-lg hover:bg-navy-tint transition-colors"
                  >
                    Edit
                  </button>
                  <button
                    onClick={() => toggleActive(v)}
                    className="text-sm font-medium text-muted hover:text-ink px-3 py-1.5 rounded-lg hover:bg-fill transition-colors"
                  >
                    {v.active ? "Deactivate" : "Activate"}
                  </button>
                </div>
              </div>
            )
          )}

          {vessels.length === 0 && !adding && (
            <div className="text-center text-muted py-12 text-sm">
              No vessels yet. Add your first boat to get started.
            </div>
          )}

          {adding ? (
            <VesselForm onSave={addVessel} onCancel={() => setAdding(false)} />
          ) : (
            <button
              onClick={() => setAdding(true)}
              className="w-full border-2 border-dashed border-hairline rounded-xl py-4 text-sm text-muted hover:border-navy/30 hover:text-navy transition-colors"
            >
              + Add vessel
            </button>
          )}
        </div>
      )}
    </div>
  );
}
