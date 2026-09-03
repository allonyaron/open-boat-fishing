"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { dollars } from "@openboat/utils";
import { fmtTimeET } from "@/lib/format";

type TripRow = {
  id: string;
  departureDate: string;
  startTime: string;
  endTime: string;
  capacity: number;
  seatsRemaining: number;
  ticketsSold: number;
  status: "scheduled" | "pending_settlement" | "sailed" | "cancelled";
  vessel: { name: string; color: string };
  product: { displayName: string };
};

type RevenueTotals = {
  earnedCents: number;
  heldCents: number;
  earnedCount: number;
  heldCount: number;
};

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}
function thisMonthStart() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
}
function fmtDate(date: string) {
  const [y, m, d] = date.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  const today = new Date(); today.setHours(0,0,0,0);
  const tomorrow = new Date(today); tomorrow.setDate(today.getDate() + 1);
  if (dt.getTime() === today.getTime()) return "Today";
  if (dt.getTime() === tomorrow.getTime()) return "Tomorrow";
  return dt.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
}

// ─── Stat card ────────────────────────────────────────────────────────────────

function StatCard({
  label,
  value,
  sub,
  accent = "default",
  loading,
}: {
  label: string;
  value: string;
  sub: string;
  accent?: "navy" | "gold" | "green" | "default";
  loading?: boolean;
}) {
  const styles = {
    navy:    { card: "bg-navy border-navy",                   label: "text-white/60",  value: "text-white",   sub: "text-white/50" },
    gold:    { card: "bg-white border-gold/30",               label: "text-muted",     value: "text-gold",    sub: "text-muted" },
    green:   { card: "bg-success-bg border-success/20",       label: "text-success",   value: "text-success", sub: "text-success/70" },
    default: { card: "bg-white border-hairline",              label: "text-muted",     value: "text-ink",     sub: "text-muted" },
  }[accent];

  return (
    <div className={`rounded-xl border px-5 py-4 ${styles.card}`}>
      <div className={`text-xs font-semibold uppercase tracking-label mb-1 ${styles.label}`}>{label}</div>
      <div className={`text-2xl font-semibold ${styles.value} ${loading ? "opacity-40" : ""}`}>{value}</div>
      <div className={`text-xs mt-0.5 ${styles.sub}`}>{sub}</div>
    </div>
  );
}

// ─── Capacity bar ─────────────────────────────────────────────────────────────

function CapBar({ sold, capacity }: { sold: number; capacity: number }) {
  const pct = capacity > 0 ? Math.round((sold / capacity) * 100) : 0;
  const color = pct >= 90 ? "#c65b4e" : pct >= 60 ? "#c99a3f" : "#0E7C7B";
  return (
    <div className="mt-1.5 h-1 w-full bg-fill rounded-full overflow-hidden">
      <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, backgroundColor: color }} />
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function AdminDashboardPage() {
  const [trips, setTrips] = useState<TripRow[]>([]);
  const [revenue, setRevenue] = useState<RevenueTotals | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const [tr, rr] = await Promise.all([
      fetch("/api/admin/trips").then((r) => r.ok ? r.json() : []),
      fetch(`/api/admin/revenue?from=${thisMonthStart()}`).then((r) => r.ok ? r.json() : null),
    ]);
    setTrips(tr);
    setRevenue(rr?.totals ?? null);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const today = todayStr();
  const upcoming = trips
    .filter((t) => t.departureDate >= today && t.status !== "cancelled")
    .slice(0, 6);

  const todayTrips = trips.filter((t) => t.departureDate === today && t.status !== "cancelled");
  const todaySold   = todayTrips.reduce((s, t) => s + Number(t.ticketsSold), 0);
  const todayCap    = todayTrips.reduce((s, t) => s + t.capacity, 0);
  const todayOpen   = todayTrips.reduce((s, t) => s + t.seatsRemaining, 0);

  // next 7 days
  const weekEnd = new Date(); weekEnd.setDate(weekEnd.getDate() + 6);
  const weekEndStr = weekEnd.toISOString().slice(0, 10);
  const weekTrips = trips.filter((t) => t.departureDate <= weekEndStr && t.departureDate >= today && t.status !== "cancelled");
  const weekTickets = weekTrips.reduce((s, t) => s + Number(t.ticketsSold), 0);

  return (
    <div className="max-w-5xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-semibold text-ink">Dashboard</h1>
          <p className="text-sm text-muted mt-0.5">
            {new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}
          </p>
        </div>
        <button
          onClick={load}
          className="text-sm text-muted hover:text-ink border border-hairline bg-white rounded-lg px-3 py-1.5 transition-colors hover:border-gray-300"
        >
          Refresh
        </button>
      </div>

      {/* Stat cards — 2 cols on mobile, 4 on desktop */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
        <StatCard
          label="Today's Trips"
          value={loading ? "—" : String(todayTrips.length)}
          sub={todayTrips.length === 1 ? "departure" : "departures"}
          accent="navy"
          loading={loading}
        />
        <StatCard
          label="Tickets Today"
          value={loading ? "—" : `${todaySold} / ${todayCap}`}
          sub={todayCap > 0 ? `${Math.round((todaySold / todayCap) * 100)}% booked` : "no trips"}
          accent="gold"
          loading={loading}
        />
        <StatCard
          label="Open Seats"
          value={loading ? "—" : String(todayOpen)}
          sub={todayOpen === 0 && todayCap > 0 ? "sold out!" : "available today"}
          accent={todayOpen === 0 && todayCap > 0 ? "green" : "default"}
          loading={loading}
        />
        <StatCard
          label="Month Revenue"
          value={loading || !revenue ? "—" : dollars(revenue.earnedCents + revenue.heldCents)}
          sub={revenue ? `${(revenue.earnedCount + revenue.heldCount)} tickets` : "loading"}
          accent="default"
          loading={loading}
        />
      </div>

      {/* Bento grid — 1 col mobile, 3 col desktop */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">

        {/* Upcoming trips — spans 2 cols on desktop */}
        <div className="md:col-span-2 bg-white rounded-xl border border-hairline overflow-hidden">
          <div className="flex items-center justify-between px-5 py-4 border-b border-hairline">
            <div>
              <div className="text-sm font-semibold text-ink">Upcoming Trips</div>
              <div className="text-xs text-muted mt-0.5">{weekTrips.length} trips · {weekTickets} tickets this week</div>
            </div>
            <Link href="/admin/trips" className="text-xs font-medium text-navy hover:underline">
              View all →
            </Link>
          </div>
          {loading ? (
            <div className="text-center text-muted py-10 text-sm">Loading…</div>
          ) : upcoming.length === 0 ? (
            <div className="text-center text-muted py-10 text-sm">No upcoming trips</div>
          ) : (
            <div className="divide-y divide-hairline">
              {upcoming.map((t) => {
                const sold = Number(t.ticketsSold);
                return (
                  <Link
                    key={t.id}
                    href={`/admin/trips/${t.id}`}
                    className="flex items-center gap-3 px-5 py-3 hover:bg-fill transition-colors"
                  >
                    <div className="w-1 h-8 rounded-full flex-shrink-0" style={{ backgroundColor: t.vessel.color }} />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium text-ink truncate">{t.vessel.name} · {t.product.displayName}</div>
                      <div className="text-xs text-muted">{fmtDate(t.departureDate)} · {fmtTimeET(t.startTime)}</div>
                      <CapBar sold={sold} capacity={t.capacity} />
                    </div>
                    <div className="text-right flex-shrink-0">
                      <div className="text-sm font-semibold text-ink">{sold}/{t.capacity}</div>
                      <div className="text-xs text-muted">{t.seatsRemaining} left</div>
                    </div>
                  </Link>
                );
              })}
            </div>
          )}
        </div>

        {/* Right column — stacks on mobile */}
        <div className="flex flex-col gap-4">

          {/* Revenue summary */}
          <div className="bg-white rounded-xl border border-hairline p-5">
            <div className="text-xs font-semibold uppercase tracking-label text-muted mb-3">This Month</div>
            {revenue ? (
              <div className="space-y-2.5">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-muted">Earned</span>
                  <span className="text-sm font-semibold text-success">{dollars(revenue.earnedCents)}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-xs text-muted">Pending settlement</span>
                  <span className="text-sm font-semibold text-amber">{dollars(revenue.heldCents)}</span>
                </div>
                <div className="pt-2 border-t border-hairline flex items-center justify-between">
                  <span className="text-xs font-semibold text-muted">Total</span>
                  <span className="text-base font-bold text-ink">{dollars(revenue.earnedCents + revenue.heldCents)}</span>
                </div>
              </div>
            ) : (
              <div className="text-sm text-faint">{loading ? "Loading…" : "No data"}</div>
            )}
            <Link href="/admin/revenue" className="mt-4 block text-xs font-medium text-navy hover:underline">
              Full revenue report →
            </Link>
          </div>

          {/* Quick links */}
          <div className="bg-white rounded-xl border border-hairline p-5">
            <div className="text-xs font-semibold uppercase tracking-label text-muted mb-3">Quick Links</div>
            <div className="space-y-1">
              {[
                { href: "/admin/trips", label: "Manage trips" },
                { href: "/admin/settings/schedules", label: "Edit schedules" },
                { href: "/admin/settings/vessels", label: "Vessels" },
                { href: "/admin/settings/staff", label: "Staff accounts" },
              ].map(({ href, label }) => (
                <Link
                  key={href}
                  href={href}
                  className="flex items-center justify-between py-2 text-sm text-ink hover:text-navy transition-colors group"
                >
                  {label}
                  <span className="text-faint group-hover:text-navy transition-colors">→</span>
                </Link>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
