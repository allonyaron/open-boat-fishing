"use client";

import { useEffect, useState } from "react";

type Operator = {
  id: string;
  name: string;
  slug: string;
  stripeOnboardingComplete: boolean;
  createdAt: string;
};

function LoginForm({ onSuccess }: { onSuccess: () => void }) {
  const [secret, setSecret] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const res = await fetch("/api/platform/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ secret }),
      });
      if (res.ok) {
        onSuccess();
      } else {
        const data = await res.json();
        setError(data.error ?? "Invalid secret");
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center">
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 w-full max-w-sm p-8">
        <h1 className="text-xl font-semibold text-gray-900 mb-1">Platform admin</h1>
        <p className="text-sm text-gray-500 mb-6">OpenBoat internal use only</p>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Platform secret</label>
            <input
              type="password"
              value={secret}
              onChange={(e) => setSecret(e.target.value)}
              required
              autoComplete="current-password"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          {error && <p className="text-sm text-red-600">{error}</p>}
          <button
            type="submit"
            disabled={loading}
            className="w-full bg-blue-600 text-white py-2 rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50 transition-colors"
          >
            {loading ? "Signing in…" : "Sign in"}
          </button>
        </form>
      </div>
    </div>
  );
}

function OperatorList() {
  const [operators, setOperators] = useState<Operator[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/platform/operators")
      .then((r) => r.json())
      .then((data) => {
        setOperators(data);
        setLoading(false);
      });
  }, []);

  async function handleLogout() {
    await fetch("/api/platform/auth", { method: "DELETE" });
    window.location.reload();
  }

  if (loading) {
    return <div className="text-center text-gray-400 py-16">Loading…</div>;
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-4xl mx-auto px-6 py-8">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-semibold text-gray-900">Platform admin</h1>
            <p className="text-sm text-gray-500 mt-0.5">{operators.length} operator{operators.length !== 1 ? "s" : ""}</p>
          </div>
          <div className="flex items-center gap-3">
            <a
              href="/platform/operators/new"
              className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors"
            >
              + New operator
            </a>
            <button
              onClick={handleLogout}
              className="text-sm text-gray-500 hover:text-gray-700"
            >
              Sign out
            </button>
          </div>
        </div>

        {operators.length === 0 ? (
          <div className="bg-white rounded-xl border border-gray-200 p-12 text-center">
            <p className="text-gray-500 mb-4">No operators yet.</p>
            <a
              href="/platform/operators/new"
              className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors"
            >
              Add first operator
            </a>
          </div>
        ) : (
          <div className="bg-white rounded-xl border border-gray-200 divide-y divide-gray-100">
            {operators.map((op) => (
              <div key={op.id} className="px-6 py-4 flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-gray-900">{op.name}</p>
                  <p className="text-xs text-gray-400 font-mono mt-0.5">{op.slug}</p>
                </div>
                <div className="flex items-center gap-4">
                  {op.stripeOnboardingComplete ? (
                    <span className="text-xs text-green-600 font-medium">Stripe connected</span>
                  ) : (
                    <span className="text-xs text-amber-600 font-medium">Stripe pending</span>
                  )}
                  <span className="text-xs text-gray-400">
                    {new Date(op.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default function PlatformPage() {
  const [authed, setAuthed] = useState<boolean | null>(null);

  useEffect(() => {
    // Probe the operators endpoint — 401 means not authenticated
    fetch("/api/platform/operators").then((r) => {
      setAuthed(r.ok);
    });
  }, []);

  if (authed === null) {
    return <div className="min-h-screen bg-gray-50 flex items-center justify-center text-gray-400">Loading…</div>;
  }

  if (!authed) {
    return <LoginForm onSuccess={() => setAuthed(true)} />;
  }

  return <OperatorList />;
}
