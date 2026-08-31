"use client";

import { useState } from "react";

type CreatedOperator = {
  operatorId: string;
  slug: string;
  domain: string;
  adminEmail: string;
  tempPassword: string;
  loginUrl: string;
};

const inputCls = "w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500";

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-sm font-medium text-gray-700 mb-1">{label}</label>
      {children}
      {hint && <p className="text-xs text-gray-400 mt-1">{hint}</p>}
    </div>
  );
}

export default function NewOperatorPage() {
  const [form, setForm] = useState({
    name: "",
    domain: "",
    emailFrom: "",
    emailDomain: "",
    adminName: "",
    adminEmail: "",
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [created, setCreated] = useState<CreatedOperator | null>(null);

  function set(key: keyof typeof form, value: string) {
    setForm((f) => ({ ...f, [key]: value }));
    setError("");
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError("");
    try {
      const res = await fetch("/api/platform/operators", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (res.ok) {
        setCreated(data as CreatedOperator);
      } else {
        setError(data.error ?? "Creation failed");
      }
    } finally {
      setSaving(false);
    }
  }

  if (created) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-6">
        <div className="bg-white rounded-xl border border-gray-200 w-full max-w-lg p-8">
          <div className="flex items-center gap-2 mb-4">
            <span className="text-green-600 text-xl">✓</span>
            <h1 className="text-xl font-semibold text-gray-900">Operator created</h1>
          </div>
          <p className="text-sm text-gray-600 mb-6">
            Save these credentials — the temporary password won't be shown again.
          </p>
          <dl className="space-y-3 text-sm">
            <div className="flex gap-4">
              <dt className="text-gray-500 w-32 shrink-0">Operator ID</dt>
              <dd className="font-mono text-xs text-gray-700 break-all">{created.operatorId}</dd>
            </div>
            <div className="flex gap-4">
              <dt className="text-gray-500 w-32 shrink-0">Slug</dt>
              <dd className="font-mono text-xs text-gray-700">{created.slug}</dd>
            </div>
            <div className="flex gap-4">
              <dt className="text-gray-500 w-32 shrink-0">Domain</dt>
              <dd className="font-mono text-xs text-gray-700">{created.domain}</dd>
            </div>
            <div className="flex gap-4">
              <dt className="text-gray-500 w-32 shrink-0">Admin email</dt>
              <dd className="font-mono text-xs text-gray-700">{created.adminEmail}</dd>
            </div>
            <div className="flex gap-4">
              <dt className="text-gray-500 w-32 shrink-0">Temp password</dt>
              <dd className="font-mono text-sm font-semibold text-gray-900 bg-yellow-50 px-2 py-0.5 rounded">
                {created.tempPassword}
              </dd>
            </div>
            <div className="flex gap-4">
              <dt className="text-gray-500 w-32 shrink-0">Login URL</dt>
              <dd className="font-mono text-xs text-blue-600 break-all">{created.loginUrl}</dd>
            </div>
          </dl>
          <div className="mt-6 flex gap-3">
            <a
              href="/platform"
              className="flex-1 text-center bg-blue-600 text-white py-2 rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors"
            >
              Back to operators
            </a>
            <button
              onClick={() => {
                const text = [
                  `Operator: ${created.slug}`,
                  `Domain: ${created.domain}`,
                  `Admin email: ${created.adminEmail}`,
                  `Temp password: ${created.tempPassword}`,
                  `Login: ${created.loginUrl}`,
                ].join("\n");
                navigator.clipboard.writeText(text);
              }}
              className="px-4 py-2 rounded-lg text-sm font-medium border border-gray-300 text-gray-700 hover:bg-gray-50 transition-colors"
            >
              Copy
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-2xl mx-auto px-6 py-8">
        <div className="flex items-center gap-3 mb-6">
          <a href="/platform" className="text-sm text-gray-400 hover:text-gray-600">Platform admin</a>
          <span className="text-gray-300">›</span>
          <h1 className="text-2xl font-semibold text-gray-900">New operator</h1>
        </div>

        <form onSubmit={handleSubmit} className="bg-white rounded-xl border border-gray-200 divide-y divide-gray-100">
          <div className="px-6 py-5 grid gap-4">
            <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide">Business</h2>
            <Field label="Business name" hint="e.g. Captree State Park Boats">
              <input
                className={inputCls}
                value={form.name}
                onChange={(e) => set("name", e.target.value)}
                required
                placeholder="MV Open Boat"
              />
            </Field>
            <Field label="Primary domain" hint="No https:// — e.g. captreeboats.com">
              <input
                className={inputCls}
                value={form.domain}
                onChange={(e) => set("domain", e.target.value)}
                required
                placeholder="captreeboats.com"
              />
            </Field>
          </div>

          <div className="px-6 py-5 grid gap-4">
            <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide">Email</h2>
            <div className="grid grid-cols-2 gap-4">
              <Field label="Reply-from address" hint="e.g. office@captreeboats.com">
                <input
                  className={inputCls}
                  value={form.emailFrom}
                  onChange={(e) => set("emailFrom", e.target.value)}
                  required
                  type="email"
                  placeholder="office@captreeboats.com"
                />
              </Field>
              <Field label="Email domain" hint="Used for DKIM/SPF alignment">
                <input
                  className={inputCls}
                  value={form.emailDomain}
                  onChange={(e) => set("emailDomain", e.target.value)}
                  required
                  placeholder="captreeboats.com"
                />
              </Field>
            </div>
          </div>

          <div className="px-6 py-5 grid gap-4">
            <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide">First admin account</h2>
            <div className="grid grid-cols-2 gap-4">
              <Field label="Admin name">
                <input
                  className={inputCls}
                  value={form.adminName}
                  onChange={(e) => set("adminName", e.target.value)}
                  required
                  placeholder="Jane Smith"
                />
              </Field>
              <Field label="Admin email">
                <input
                  className={inputCls}
                  value={form.adminEmail}
                  onChange={(e) => set("adminEmail", e.target.value)}
                  required
                  type="email"
                  placeholder="jane@captreeboats.com"
                />
              </Field>
            </div>
            <p className="text-xs text-gray-400">A temporary password will be generated. Share it with the operator to complete setup.</p>
          </div>

          <div className="px-6 py-4 flex items-center justify-between">
            {error && <p className="text-sm text-red-600">{error}</p>}
            {!error && <span />}
            <div className="flex items-center gap-3">
              <a href="/platform" className="text-sm text-gray-500 hover:text-gray-700">Cancel</a>
              <button
                type="submit"
                disabled={saving}
                className="bg-blue-600 text-white px-5 py-2 rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50 transition-colors"
              >
                {saving ? "Creating…" : "Create operator"}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
