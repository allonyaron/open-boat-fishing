"use client";

import { useEffect, useState } from "react";

type Op = {
  name: string;
  emailFrom: string;
  emailDomain: string;
  phone: string | null;
  dockAddress: string | null;
  dockMapsUrl: string | null;
  termsUrl: string | null;
  twilioFromNumber: string | null;
  feeBearer: "passenger" | "operator";
  feeDisplay: "itemized" | "folded";
  cancelWindowHrs: number;
  settleGraceHrs: number;
};

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-sm font-medium text-gray-700 mb-1">{label}</label>
      {children}
    </div>
  );
}

const inputCls = "w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500";
const selectCls = inputCls;

export default function OperatorSettingsPage() {
  const [form, setForm] = useState<Op | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch("/api/admin/settings/operator")
      .then((r) => r.json())
      .then((data) => {
        setForm(data);
        setLoading(false);
      });
  }, []);

  function set(key: keyof Op, value: string | number) {
    setForm((f) => f && ({ ...f, [key]: value }));
    setSaved(false);
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!form) return;
    setSaving(true);
    setError("");
    const res = await fetch("/api/admin/settings/operator", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });
    const data = await res.json();
    setSaving(false);
    if (res.ok) {
      setForm(data);
      setSaved(true);
    } else {
      setError(data.error ?? "Save failed");
    }
  }

  if (loading || !form) {
    return <div className="text-center text-gray-400 py-16">Loading…</div>;
  }

  return (
    <div className="max-w-2xl mx-auto">
      <div className="flex items-center gap-3 mb-6">
        <a href="/admin/settings" className="text-sm text-gray-400 hover:text-gray-600">Settings</a>
        <span className="text-gray-300">›</span>
        <h1 className="text-2xl font-semibold text-gray-900">Business Info</h1>
      </div>

      <form onSubmit={save} className="bg-white rounded-xl border border-gray-200 divide-y divide-gray-100">
        <div className="px-6 py-5 grid gap-4">
          <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide">General</h2>
          <Field label="Business name">
            <input className={inputCls} value={form.name} onChange={(e) => set("name", e.target.value)} required />
          </Field>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Reply-from email">
              <input className={inputCls} value={form.emailFrom} onChange={(e) => set("emailFrom", e.target.value)} required />
            </Field>
            <Field label="Email domain">
              <input className={inputCls} value={form.emailDomain} onChange={(e) => set("emailDomain", e.target.value)} required />
            </Field>
          </div>
          <Field label="Phone">
            <input className={inputCls} value={form.phone ?? ""} onChange={(e) => set("phone", e.target.value)} />
          </Field>
          <Field label="Dock address">
            <input className={inputCls} value={form.dockAddress ?? ""} onChange={(e) => set("dockAddress", e.target.value)} />
          </Field>
          <Field label="Google Maps URL (dock)">
            <input className={inputCls} value={form.dockMapsUrl ?? ""} onChange={(e) => set("dockMapsUrl", e.target.value)} />
          </Field>
          <Field label="Terms & conditions URL">
            <input className={inputCls} value={form.termsUrl ?? ""} onChange={(e) => set("termsUrl", e.target.value)} />
          </Field>
          <Field label="Twilio SMS number (optional)">
            <input className={inputCls} value={form.twilioFromNumber ?? ""} onChange={(e) => set("twilioFromNumber", e.target.value)} placeholder="+15165550000" />
          </Field>
        </div>

        <div className="px-6 py-5 grid gap-4">
          <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide">Fees</h2>
          <Field label="Platform fee paid by">
            <select className={selectCls} value={form.feeBearer} onChange={(e) => set("feeBearer", e.target.value as Op["feeBearer"])}>
              <option value="passenger">Passenger (added to ticket price)</option>
              <option value="operator">Operator (absorbed by you)</option>
            </select>
          </Field>
          <Field label="Fee display">
            <select className={selectCls} value={form.feeDisplay} onChange={(e) => set("feeDisplay", e.target.value as Op["feeDisplay"])}>
              <option value="itemized">Itemized (shown as a separate line)</option>
              <option value="folded">Folded into ticket price</option>
            </select>
          </Field>
        </div>

        <div className="px-6 py-5 grid gap-4">
          <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide">Policy windows</h2>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Cancellation window (hours)">
              <input
                className={inputCls}
                type="number"
                min={0}
                value={form.cancelWindowHrs}
                onChange={(e) => set("cancelWindowHrs", Number(e.target.value))}
              />
            </Field>
            <Field label="Settlement grace (hours)">
              <input
                className={inputCls}
                type="number"
                min={0}
                value={form.settleGraceHrs}
                onChange={(e) => set("settleGraceHrs", Number(e.target.value))}
              />
            </Field>
          </div>
          <p className="text-xs text-gray-400">
            Cancellation window: how many hours before departure a customer can self-cancel.
            Settlement grace: how many hours after departure before fees are marked earned.
          </p>
        </div>

        <div className="px-6 py-4 flex items-center justify-between">
          {error && <p className="text-sm text-red-600">{error}</p>}
          {saved && !error && <p className="text-sm text-green-600">Saved</p>}
          {!error && !saved && <span />}
          <button
            type="submit"
            disabled={saving}
            className="bg-blue-600 text-white px-5 py-2 rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50 transition-colors"
          >
            {saving ? "Saving…" : "Save changes"}
          </button>
        </div>
      </form>
    </div>
  );
}
