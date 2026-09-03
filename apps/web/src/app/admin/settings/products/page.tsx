"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

type Price = { ticketType: "adult" | "child" | "senior"; priceCents: number };
type Product = {
  id: string;
  vesselId: string;
  category: string;
  displayName: string;
  description: string | null;
  showRemaining: boolean;
  active: boolean;
  prices: Price[];
  vessel: { id: string; name: string; color: string };
};
type Vessel = { id: string; name: string; color: string };

const inputCls = "w-full border border-hairline rounded-lg px-3 py-2 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-navy";
const TICKET_TYPES = ["adult", "child", "senior"] as const;

function dollars(cents: number) {
  return (cents / 100).toFixed(2);
}

function PriceRow({ type, value, onChange }: { type: string; value: string; onChange: (v: string) => void }) {
  return (
    <div className="flex items-center gap-3">
      <span className="text-sm text-muted capitalize w-14">{type}</span>
      <div className="relative flex-1 max-w-[120px]">
        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted text-sm">$</span>
        <input
          className="w-full border border-hairline rounded-lg pl-7 pr-3 py-1.5 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-navy"
          type="number"
          min={0}
          step={0.01}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="0.00"
        />
      </div>
    </div>
  );
}

function ProductForm({
  vessels,
  initial,
  onSave,
  onCancel,
}: {
  vessels: Vessel[];
  initial?: Partial<Product>;
  onSave: (data: Record<string, unknown>) => Promise<string | null>;
  onCancel: () => void;
}) {
  const [vesselId, setVesselId] = useState(initial?.vesselId ?? vessels[0]?.id ?? "");
  const [category, setCategory] = useState(initial?.category ?? "");
  const [displayName, setDisplayName] = useState(initial?.displayName ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [showRemaining, setShowRemaining] = useState(initial?.showRemaining ?? false);
  const [prices, setPrices] = useState<Record<string, string>>({
    adult: initial?.prices?.find((p) => p.ticketType === "adult") ? dollars(initial.prices.find((p) => p.ticketType === "adult")!.priceCents) : "",
    child: initial?.prices?.find((p) => p.ticketType === "child") ? dollars(initial.prices.find((p) => p.ticketType === "child")!.priceCents) : "",
    senior: initial?.prices?.find((p) => p.ticketType === "senior") ? dollars(initial.prices.find((p) => p.ticketType === "senior")!.priceCents) : "",
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError("");
    const priceRows = TICKET_TYPES
      .filter((t) => prices[t] !== "" && !isNaN(Number(prices[t])))
      .map((t) => ({ ticketType: t, priceCents: Math.round(Number(prices[t]) * 100) }));
    const err = await onSave({ vesselId, category, displayName, description: description || undefined, showRemaining, prices: priceRows });
    setSaving(false);
    if (err) setError(err);
  }

  return (
    <form onSubmit={submit} className="bg-fill rounded-xl border border-hairline p-5 grid gap-4">
      <div className="grid sm:grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-ink mb-1">Vessel</label>
          <select className={inputCls} value={vesselId} onChange={(e) => setVesselId(e.target.value)} required>
            {vessels.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium text-ink mb-1">Category (fish species)</label>
          <input className={inputCls} value={category} onChange={(e) => setCategory(e.target.value)} required placeholder="Sea Bass" />
        </div>
      </div>
      <div>
        <label className="block text-sm font-medium text-ink mb-1">Display name</label>
        <input className={inputCls} value={displayName} onChange={(e) => setDisplayName(e.target.value)} required placeholder="Sea Bass Fishing Express" />
      </div>
      <div>
        <label className="block text-sm font-medium text-ink mb-1">Description (optional)</label>
        <input className={inputCls} value={description} onChange={(e) => setDescription(e.target.value)} />
      </div>

      <div>
        <div className="text-sm font-medium text-ink mb-2">Ticket prices</div>
        <div className="grid gap-2">
          {TICKET_TYPES.map((t) => (
            <PriceRow key={t} type={t} value={prices[t]} onChange={(v) => setPrices((p) => ({ ...p, [t]: v }))} />
          ))}
        </div>
      </div>

      <label className="flex items-center gap-2 text-sm text-ink cursor-pointer">
        <input type="checkbox" checked={showRemaining} onChange={(e) => setShowRemaining(e.target.checked)} className="rounded" />
        Show remaining seats to customers
      </label>

      {error && <p className="text-sm text-warning">{error}</p>}

      <div className="flex gap-3 justify-end">
        <button type="button" onClick={onCancel} className="border border-hairline text-ink px-4 py-2 rounded-lg text-sm hover:bg-white transition-colors">Cancel</button>
        <button type="submit" disabled={saving} className="bg-navy text-white px-4 py-2 rounded-lg text-sm font-medium hover:opacity-90 disabled:opacity-50 transition-opacity">
          {saving ? "Saving…" : initial?.id ? "Save changes" : "Add trip type"}
        </button>
      </div>
    </form>
  );
}

export default function ProductsPage() {
  const [products, setProducts] = useState<Product[]>([]);
  const [vessels, setVessels] = useState<Vessel[]>([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    const [pr, vr] = await Promise.all([
      fetch("/api/admin/settings/products").then((r) => r.json()),
      fetch("/api/admin/settings/vessels").then((r) => r.json()),
    ]);
    setProducts(pr);
    setVessels(vr.filter((v: Vessel & { active: boolean }) => v.active));
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  async function addProduct(data: Record<string, unknown>): Promise<string | null> {
    const res = await fetch("/api/admin/settings/products", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    const json = await res.json();
    if (!res.ok) return json.error ?? "Failed to add trip type";
    setAdding(false);
    await load();
    return null;
  }

  async function updateProduct(id: string, data: Record<string, unknown>): Promise<string | null> {
    const res = await fetch(`/api/admin/settings/products/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    const json = await res.json();
    if (!res.ok) return json.error ?? "Failed to update trip type";
    setEditing(null);
    await load();
    return null;
  }

  async function toggleActive(p: Product) {
    await fetch(`/api/admin/settings/products/${p.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ active: !p.active }),
    });
    await load();
  }

  const byVessel: Record<string, Product[]> = {};
  for (const p of products) {
    if (!byVessel[p.vessel.id]) byVessel[p.vessel.id] = [];
    byVessel[p.vessel.id].push(p);
  }

  return (
    <div className="max-w-3xl mx-auto">
      <div className="flex items-center gap-2 mb-6">
        <Link href="/admin/settings" className="text-sm text-muted hover:text-ink transition-colors">Settings</Link>
        <span className="text-hairline">›</span>
        <h1 className="text-xl font-semibold text-ink">Trip Types &amp; Pricing</h1>
      </div>

      {loading ? (
        <div className="text-center text-muted py-16 text-sm">Loading…</div>
      ) : (
        <div className="space-y-6">
          {Object.entries(byVessel).map(([, vProducts]) => {
            const v = vProducts[0].vessel;
            return (
              <section key={v.id}>
                <div className="flex items-center gap-2 mb-2 px-1">
                  <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: v.color }} />
                  <h2 className="text-xs font-semibold text-muted uppercase tracking-label">{v.name}</h2>
                </div>
                <div className="bg-white rounded-xl border border-hairline divide-y divide-hairline">
                  {vProducts.map((p) =>
                    editing === p.id ? (
                      <div key={p.id} className="p-3">
                        <ProductForm vessels={vessels} initial={p} onSave={(data) => updateProduct(p.id, data)} onCancel={() => setEditing(null)} />
                      </div>
                    ) : (
                      <div key={p.id} className="px-5 py-4 flex items-start gap-3">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-semibold text-sm text-ink">{p.displayName}</span>
                            <span className="text-xs text-muted">{p.category}</span>
                            {!p.active && <span className="text-xs px-2 py-0.5 rounded-full bg-fill text-muted">Inactive</span>}
                          </div>
                          <div className="text-xs text-muted mt-1 flex gap-3 flex-wrap">
                            {p.prices.map((pr) => (
                              <span key={pr.ticketType} className="capitalize">
                                {pr.ticketType}: ${dollars(pr.priceCents)}
                              </span>
                            ))}
                            {p.prices.length === 0 && <span className="text-amber">No prices set</span>}
                          </div>
                        </div>
                        <div className="flex gap-1 flex-shrink-0">
                          <button onClick={() => setEditing(p.id)} className="text-sm font-medium text-navy hover:text-navy-light px-3 py-1.5 rounded-lg hover:bg-navy-tint transition-colors">Edit</button>
                          <button onClick={() => toggleActive(p)} className="text-sm font-medium text-muted hover:text-ink px-3 py-1.5 rounded-lg hover:bg-fill transition-colors">
                            {p.active ? "Deactivate" : "Activate"}
                          </button>
                        </div>
                      </div>
                    )
                  )}
                </div>
              </section>
            );
          })}

          {products.length === 0 && !adding && (
            <div className="text-center text-muted py-12 text-sm">
              No trip types yet.{" "}
              {vessels.length === 0 && <span>Add a vessel first, then come back to define trip types.</span>}
            </div>
          )}

          {vessels.length > 0 && (
            adding ? (
              <ProductForm vessels={vessels} onSave={addProduct} onCancel={() => setAdding(false)} />
            ) : (
              <button
                onClick={() => setAdding(true)}
                className="w-full border-2 border-dashed border-hairline rounded-xl py-4 text-sm text-muted hover:border-navy/30 hover:text-navy transition-colors"
              >
                + Add trip type
              </button>
            )
          )}
        </div>
      )}
    </div>
  );
}
