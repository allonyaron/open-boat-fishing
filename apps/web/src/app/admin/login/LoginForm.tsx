"use client";

import { useState, FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Card, Button, Input, Label } from "@/components/admin/merchant";

export function LoginForm({ operatorName }: { operatorName: string | null }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
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

  return (
    <div className="min-h-screen bg-merchant-chrome flex items-center justify-center px-4">
      <div className="w-full max-w-[380px]" style={{ boxShadow: "0 10px 40px rgba(0,0,0,0.4)" }}>
        <Card>
          <div className="p-6">
            <div className="mb-6">
              <div className="text-14 font-bold text-merchant-ink">Open Boat</div>
              {operatorName && <div className="text-13 text-merchant-muted mt-0.5">{operatorName}</div>}
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <Label htmlFor="login-email">Email</Label>
                <Input
                  id="login-email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  autoComplete="username"
                  autoFocus
                />
              </div>
              <div>
                <Label htmlFor="login-password">Password</Label>
                <Input
                  id="login-password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  autoComplete="current-password"
                />
              </div>

              {error && (
                <div className="rounded-lg bg-merchant-red-tint px-3 py-2.5 text-13 text-merchant-red">
                  {error}
                </div>
              )}

              <Button type="submit" variant="primary" disabled={loading} className="w-full">
                {loading ? "Signing in…" : "Sign in"}
              </Button>

              <p className="text-12 text-merchant-faint text-center">
                Full access — schedule, money, settings.
              </p>
            </form>
          </div>
        </Card>
      </div>
    </div>
  );
}
