"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";

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
  stripeAccountId: string | null;
  stripeOnboardingComplete: boolean;
};

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-sm font-medium text-ink mb-1">{label}</label>
      {children}
    </div>
  );
}

const inputCls = "w-full border border-hairline rounded-lg px-3 py-2 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-navy";

export default function OperatorSettingsPage() {
  const [form, setForm] = useState<Op | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");
  const searchParams = useSearchParams();
  const stripeStatus = searchParams.get("stripe");

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
    return <div className="text-center text-muted py-16 text-sm">Loading…</div>;
  }

  return (
    <div className="max-w-2xl mx-auto">
      <div className="flex items-center gap-2 mb-6">
        <Link href="/admin/settings" className="text-sm text-muted hover:text-ink transition-colors">Settings</Link>
        <span className="text-hairline">›</span>
        <h1 className="text-xl font-semibold text-ink">Business Info</h1>
      </div>

      <form onSubmit={save} className="bg-white rounded-xl border border-hairline divide-y divide-hairline">
        <div className="px-6 py-5 grid gap-4">
          <h2 className="text-xs font-semibold text-muted uppercase tracking-label">General</h2>
          <Field label="Business name">
            <input className={inputCls} value={form.name} onChange={(e) => set("name", e.target.value)} required />
          </Field>
          <div className="grid sm:grid-cols-2 gap-4">
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
          <h2 className="text-xs font-semibold text-muted uppercase tracking-label">Fees</h2>
          <Field label="Platform fee paid by">
            <select className={inputCls} value={form.feeBearer} onChange={(e) => set("feeBearer", e.target.value as Op["feeBearer"])}>
              <option value="passenger">Passenger (added to ticket price)</option>
              <option value="operator">Operator (absorbed by you)</option>
            </select>
          </Field>
          <Field label="Fee display">
            <select className={inputCls} value={form.feeDisplay} onChange={(e) => set("feeDisplay", e.target.value as Op["feeDisplay"])}>
              <option value="itemized">Itemized (shown as a separate line)</option>
              <option value="folded">Folded into ticket price</option>
            </select>
          </Field>
        </div>

        <div className="px-6 py-5 grid gap-4">
          <h2 className="text-xs font-semibold text-muted uppercase tracking-label">Policy windows</h2>
          <div className="grid sm:grid-cols-2 gap-4">
            <Field label="Cancellation window (hours)">
              <input className={inputCls} type="number" min={0} value={form.cancelWindowHrs} onChange={(e) => set("cancelWindowHrs", Number(e.target.value))} />
            </Field>
            <Field label="Settlement grace (hours)">
              <input className={inputCls} type="number" min={0} value={form.settleGraceHrs} onChange={(e) => set("settleGraceHrs", Number(e.target.value))} />
            </Field>
          </div>
          <p className="text-xs text-faint">
            Cancellation window: how many hours before departure a customer can self-cancel.
            Settlement grace: how many hours after departure before fees are marked earned.
          </p>
        </div>

        <div className="px-6 py-5 grid gap-4">
          <h2 className="text-xs font-semibold text-muted uppercase tracking-label">Stripe</h2>
          {stripeStatus === "connected" && (
            <p className="text-sm text-success font-medium">Stripe account connected successfully.</p>
          )}
          {stripeStatus === "error" && (
            <p className="text-sm text-warning">Something went wrong connecting Stripe. Try again.</p>
          )}
          {stripeStatus === "cancelled" && (
            <p className="text-sm text-muted">Stripe connection cancelled.</p>
          )}
          <div className="flex items-center justify-between">
            <div>
              {form.stripeOnboardingComplete && form.stripeAccountId ? (
                <>
                  <p className="text-sm font-semibold text-success">Connected</p>
                  <p className="text-xs text-faint font-mono mt-0.5">{form.stripeAccountId}</p>
                </>
              ) : (
                <p className="text-sm text-muted">No Stripe account connected.</p>
              )}
            </div>
            <a
              href="/api/stripe/connect/start"
              className="bg-[#635BFF] text-white px-4 py-2 rounded-lg text-sm font-medium hover:opacity-90 transition-opacity"
            >
              {form.stripeOnboardingComplete ? "Reconnect Stripe" : "Connect Stripe"}
            </a>
          </div>
        </div>

        <div className="px-6 py-4 flex items-center justify-between">
          <div>
            {error && <p className="text-sm text-warning">{error}</p>}
            {saved && !error && <p className="text-sm text-success font-medium">Saved</p>}
          </div>
          <button
            type="submit"
            disabled={saving}
            className="bg-navy text-white px-5 py-2 rounded-lg text-sm font-medium hover:opacity-90 disabled:opacity-50 transition-opacity"
          >
            {saving ? "Saving…" : "Save changes"}
          </button>
        </div>
      </form>
    </div>
  );
}
