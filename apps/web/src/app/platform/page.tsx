"use client";

import { useCallback, useEffect, useState } from "react";

type Operator = {
  id: string;
  name: string;
  slug: string;
  stripeOnboardingComplete: boolean;
  createdAt: string;
};

type Me = { id: string; name: string; email: string };
type Gate = { configured: boolean; needsFirstAccount: boolean };

const inputClass =
  "w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500";

function Field(props: {
  label: string;
  type?: string;
  value: string;
  onChange: (v: string) => void;
  autoComplete?: string;
  hint?: string;
}) {
  return (
    <label className="block">
      <span className="block text-sm font-medium text-gray-700 mb-1">{props.label}</span>
      <input
        type={props.type ?? "text"}
        value={props.value}
        onChange={(e) => props.onChange(e.target.value)}
        required
        autoComplete={props.autoComplete}
        className={inputClass}
      />
      {props.hint && <span className="block text-xs text-gray-400 mt-1">{props.hint}</span>}
    </label>
  );
}

// Sign in with a platform account, or, while none exists, create the first
// one with PLATFORM_SECRET (row 12).
function AuthForm({ gate, onSuccess }: { gate: Gate; onSuccess: () => void }) {
  const firstAccount = gate.needsFirstAccount;
  const [secret, setSecret] = useState("");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const res = await fetch(firstAccount ? "/api/platform/auth/setup" : "/api/platform/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(firstAccount ? { secret, name, email, password } : { email, password }),
      });
      if (res.ok) {
        onSuccess();
      } else {
        const data = await res.json().catch(() => ({}));
        setError(data.error ?? "Couldn't sign in");
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 w-full max-w-sm p-8">
        <h1 className="text-xl font-semibold text-gray-900 mb-1">
          {firstAccount ? "Create the first platform account" : "Platform admin"}
        </h1>
        <p className="text-sm text-gray-500 mb-6">
          {!gate.configured
            ? "The platform console isn't set up on this deployment (PLATFORM_SECRET is not set)."
            : firstAccount
              ? "Enter the platform secret once to create your own account. After that, everyone signs in with their own email and password."
              : "OpenBoat internal use only"}
        </p>
        {gate.configured && (
          <form onSubmit={handleSubmit} className="space-y-4">
            {firstAccount && (
              <>
                <Field label="Platform secret" type="password" value={secret} onChange={setSecret} autoComplete="off" />
                <Field label="Your name" value={name} onChange={setName} autoComplete="name" />
              </>
            )}
            <Field label="Email" type="email" value={email} onChange={setEmail} autoComplete="email" />
            <Field
              label="Password"
              type="password"
              value={password}
              onChange={setPassword}
              autoComplete={firstAccount ? "new-password" : "current-password"}
              hint={firstAccount ? "At least 8 characters" : undefined}
            />
            {error && <p className="text-sm text-red-600">{error}</p>}
            <button
              type="submit"
              disabled={loading}
              className="w-full bg-blue-600 text-white py-2 rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50 transition-colors"
            >
              {loading ? (firstAccount ? "Creating…" : "Signing in…") : firstAccount ? "Create account" : "Sign in"}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}

type PlatformUser = { id: string; name: string; email: string; active: boolean; createdAt: string };

// Who can sign in to the platform console. Anyone signed in can add people
// and deactivate anyone but themselves.
function PlatformUsers({ me }: { me: Me }) {
  const [users, setUsers] = useState<PlatformUser[]>([]);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");

  async function load() {
    const res = await fetch("/api/platform/users");
    if (res.ok) setUsers(await res.json());
  }
  useEffect(() => {
    load();
  }, []);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    const res = await fetch("/api/platform/users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, email, password }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error === "Invalid request" ? "Check the name, email and password (8+ characters)" : data.error ?? "Couldn't add");
      return;
    }
    setName("");
    setEmail("");
    setPassword("");
    setAdding(false);
    load();
  }

  async function setActive(user: PlatformUser, active: boolean) {
    await fetch(`/api/platform/users/${user.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ active }),
    });
    load();
  }

  return (
    <div className="mt-10">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-lg font-semibold text-gray-900">Platform users</h2>
        {!adding && (
          <button onClick={() => setAdding(true)} className="text-sm text-blue-600 hover:text-blue-700 font-medium">
            + Add person
          </button>
        )}
      </div>
      {adding && (
        <form onSubmit={add} className="bg-white rounded-xl border border-gray-200 p-4 mb-3 grid gap-3 sm:grid-cols-3">
          <Field label="Name" value={name} onChange={setName} autoComplete="off" />
          <Field label="Email" type="email" value={email} onChange={setEmail} autoComplete="off" />
          <Field label="Password" type="password" value={password} onChange={setPassword} autoComplete="new-password" />
          {error && <p className="text-sm text-red-600 sm:col-span-3">{error}</p>}
          <div className="flex gap-3 sm:col-span-3">
            <button type="submit" className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700">
              Add
            </button>
            <button type="button" onClick={() => setAdding(false)} className="text-sm text-gray-500 hover:text-gray-700">
              Cancel
            </button>
          </div>
        </form>
      )}
      <div className="bg-white rounded-xl border border-gray-200 divide-y divide-gray-100">
        {users.map((u) => (
          <div key={u.id} className="px-6 py-3 flex items-center justify-between gap-4">
            <div className="min-w-0">
              <p className="text-sm font-medium text-gray-900 truncate">
                {u.name} {u.id === me.id && <span className="text-xs text-gray-400 font-normal">(you)</span>}
                {!u.active && <span className="text-xs text-amber-600 font-normal ml-1">Deactivated</span>}
              </p>
              <p className="text-xs text-gray-400 truncate">{u.email}</p>
            </div>
            {u.id !== me.id &&
              (u.active ? (
                <button onClick={() => setActive(u, false)} className="text-xs text-gray-500 hover:text-red-600 shrink-0">
                  Deactivate
                </button>
              ) : (
                <button onClick={() => setActive(u, true)} className="text-xs text-blue-600 hover:text-blue-700 shrink-0">
                  Reactivate
                </button>
              ))}
          </div>
        ))}
      </div>
    </div>
  );
}

function OperatorList({ me }: { me: Me }) {
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
            <p className="text-sm text-gray-500 mt-0.5">
              {operators.length} operator{operators.length !== 1 ? "s" : ""} · signed in as {me.name}
            </p>
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

        <PlatformUsers me={me} />
      </div>
    </div>
  );
}

export default function PlatformPage() {
  const [state, setState] = useState<{ me: Me } | { gate: Gate } | null>(null);

  const check = useCallback(() => {
    fetch("/api/platform/me").then(async (r) => {
      const data = await r.json().catch(() => ({}));
      setState(
        r.ok
          ? { me: data as Me }
          : { gate: { configured: !!data.configured, needsFirstAccount: !!data.needsFirstAccount } },
      );
    });
  }, []);
  useEffect(check, [check]);

  if (state === null) {
    return <div className="min-h-screen bg-gray-50 flex items-center justify-center text-gray-400">Loading…</div>;
  }

  if ("gate" in state) {
    return <AuthForm gate={state.gate} onSuccess={check} />;
  }

  return <OperatorList me={state.me} />;
}
