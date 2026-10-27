"use client";

import { useState, FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Button, Input, Label, Lamp, SunlightButton, Wordmark } from "@/components/admin/merchant";

export function LoginForm({ operatorName }: { operatorName: string | null }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const res = await fetch("/api/admin/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      if (res.ok) {
        router.replace("/admin");
      } else {
        const data = await res.json();
        setError(data.error ?? "Login failed");
      }
    } finally {
      setLoading(false);
    }
  }

  const invalid = !!error;

  return (
    <div className="min-h-screen flex flex-col bg-ob-bg text-ob-ink font-ui text-body antialiased">
      <header className="flex items-center justify-between min-h-navbar px-4 bg-ob-panel border-b-2 border-ob-rule">
        <Wordmark />
        <SunlightButton tall />
      </header>
      <main className="flex-1 flex items-start justify-center pt-24 px-6 pb-12 max-md:pt-6 max-md:px-3">
        <form
          onSubmit={handleSubmit}
          aria-labelledby="signin-h"
          className="w-full max-w-[420px] bg-ob-panel border-2 border-ob-rule rounded-ob"
        >
          <div className="px-6 py-5 border-b-2 border-ob-rule max-md:px-4">
            <h1 id="signin-h" className="text-28 font-extrabold tracking-[-0.02em] leading-tight">
              Sign in
            </h1>
            {operatorName && <div className="text-body text-ob-ink-2 mt-0.5">{operatorName}</div>}
          </div>
          <div className="flex flex-col gap-[18px] p-6 max-md:px-4">
            <div>
              <Label htmlFor="login-email">Email</Label>
              <Input
                id="login-email"
                type="email"
                tall
                invalid={invalid}
                aria-describedby={invalid ? "login-error" : undefined}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoComplete="username"
                autoFocus
              />
            </div>
            <div>
              <Label htmlFor="login-password">Password</Label>
              <div
                className={`flex min-h-tap-main bg-ob-bg border-2 rounded-ob has-[input:focus-visible]:outline has-[input:focus-visible]:outline-[3px] has-[input:focus-visible]:outline-ob-focus has-[input:focus-visible]:outline-offset-2 ${
                  invalid ? "border-ob-alert" : "border-ob-control"
                }`}
              >
                <input
                  id="login-password"
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  autoComplete="current-password"
                  aria-invalid={invalid || undefined}
                  aria-describedby={invalid ? "login-error" : undefined}
                  className="flex-1 min-w-0 px-3.5 bg-transparent text-ob-ink text-body border-0 focus:outline-none"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  aria-label={showPassword ? "Hide password" : "Show password"}
                  aria-controls="login-password"
                  className="min-w-[72px] px-2 bg-transparent text-ob-ink border-l-2 border-ob-hair text-body-sm font-bold hover:bg-ob-panel-2"
                >
                  {showPassword ? "Hide" : "Show"}
                </button>
              </div>
            </div>

            {error && (
              <div
                id="login-error"
                role="alert"
                className="flex items-start gap-2.5 px-3.5 py-3 bg-ob-alert-tint border-2 border-ob-alert text-body-sm"
              >
                <Lamp tone="alert" size={10} className="mt-[5px]" />
                {error}
              </div>
            )}

            <Button type="submit" variant="key" size="main" disabled={loading} className="w-full text-17 font-extrabold">
              {loading ? "Signing in…" : "Sign in"}
            </Button>

            <p className="m-0 text-body-sm text-ob-ink-2">Full access — schedule, money, settings.</p>
          </div>
        </form>
      </main>
    </div>
  );
}
