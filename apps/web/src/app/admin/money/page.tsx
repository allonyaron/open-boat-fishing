"use client";

import { useEffect, useState, useCallback } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { dollars } from "@openboat/utils";
import { fmtTimeET } from "@/lib/format";
import { Card, Button, useToast } from "@/components/admin/merchant";

type OperatorInfo = { stripeAccountId: string | null; stripeOnboardingComplete: boolean };

type RevenueTrip = {
  tripId: string;
  departureDate: string;
  startTime: string;
  status: "scheduled" | "pending_settlement" | "sailed" | "cancelled";
  vesselName: string;
  vesselColor: string;
  productName: string;
  earnedCount: number;
  heldCount: number;
  reversedCount: number;
  earnedCents: number;
  heldCents: number;
  reversedCents: number;
};

type RevenueResponse = {
  totals: {
    earnedCents: number;
    heldCents: number;
    reversedCents: number;
    earnedCount: number;
    heldCount: number;
    reversedCount: number;
  };
  trips: RevenueTrip[];
};

const PERIODS = [
  { label: "30 days", days: 30 },
  { label: "90 days", days: 90 },
  { label: "12 months", days: 365 },
];

const LEDGER_STATUS: Record<RevenueTrip["status"], { label: string; bg: string; fg: string }> = {
  scheduled: { label: "Coming up", bg: "#e3e3e3", fg: "#4a4a4a" },
  pending_settlement: { label: "Just sailed", bg: "#ffd6a4", fg: "#5e4200" },
  sailed: { label: "Sailed", bg: "#cdfee1", fg: "#0c5132" },
  cancelled: { label: "Cancelled", bg: "#fee9e8", fg: "#8e1f0b" },
};

function LedgerStatusPill({ status }: { status: RevenueTrip["status"] }) {
  const s = LEDGER_STATUS[status];
  return (
    <span
      className="inline-flex items-center rounded-full px-2.5 py-0.5 text-12 font-semibold"
      style={{ backgroundColor: s.bg, color: s.fg }}
    >
      {s.label}
    </span>
  );
}

export default function MoneyPage() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const { showToast } = useToast();

  const [operator, setOperator] = useState<OperatorInfo | null>(null);
  const [revenue, setRevenue] = useState<RevenueResponse | null>(null);
  const [error, setError] = useState(false);
  const [days, setDays] = useState(90);
  const [announcedStripeParam, setAnnouncedStripeParam] = useState(false);

  const load = useCallback(async (periodDays: number) => {
    setError(false);
    try {
      const to = new Date().toISOString().slice(0, 10);
      const from = new Date(Date.now() - periodDays * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
      const [opRes, revRes] = await Promise.all([
        fetch("/api/admin/settings/operator"),
        fetch(`/api/admin/revenue?from=${from}&to=${to}`),
      ]);
      if (!opRes.ok || !revRes.ok) throw new Error("failed");
      setOperator(await opRes.json());
      setRevenue(await revRes.json());
    } catch {
      setError(true);
    }
  }, []);

  useEffect(() => {
    load(days);
  }, [load, days]);

  // Transient OAuth-return feedback — the persistent banner below already
  // reflects connected/not-connected from operator.stripeAccountId; this just
  // confirms what happened on the trip back from Stripe.
  useEffect(() => {
    const stripeParam = searchParams.get("stripe");
    if (!stripeParam || announcedStripeParam) return;
    setAnnouncedStripeParam(true);
    if (stripeParam === "connected") showToast("Stripe connected. Payouts are on.");
    else if (stripeParam === "cancelled") showToast("Stripe connection cancelled — payouts are still off.");
    else if (stripeParam === "error") showToast("Something went wrong connecting Stripe. Try again.");
    router.replace("/admin/money");
  }, [searchParams, announcedStripeParam, showToast, router]);

  if (error) {
    return (
      <div className="rounded-xl border border-merchant-red-tint bg-[#fff8f7] p-5">
        <div className="text-14 font-semibold text-merchant-red">Can&rsquo;t reach the booking system</div>
        <p className="mt-1 text-13 text-merchant-muted">Money just can&rsquo;t load right now.</p>
        <Button variant="secondary" className="mt-3" onClick={() => load(days)}>
          Try again
        </Button>
      </div>
    );
  }

  const connected = !!operator?.stripeAccountId;
  const totals = revenue?.totals;

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-20 font-bold text-merchant-ink" style={{ letterSpacing: "-0.01em" }}>
        Money
      </h1>

      {operator &&
        (connected ? (
          <div className="rounded-xl border border-merchant-hairline bg-merchant-green-tint px-4 py-3.5 flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="text-14 font-semibold text-merchant-green">Payouts are on</div>
              <div className="text-13 text-merchant-green mt-0.5">
                Connected to Stripe account {operator.stripeAccountId}.
              </div>
            </div>
            <a
              href="https://dashboard.stripe.com"
              target="_blank"
              rel="noreferrer"
              className="flex-shrink-0 inline-flex items-center justify-center rounded-lg bg-merchant-chrome-mid text-white text-13 font-semibold px-3.5"
              style={{ minHeight: "38px" }}
            >
              Open Stripe
            </a>
          </div>
        ) : (
          <div className="rounded-xl border border-merchant-hairline bg-merchant-amber-soft px-4 py-3.5 flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="text-14 font-semibold text-merchant-amber-deep">Payouts aren&rsquo;t set up yet</div>
              <div className="text-13 text-merchant-amber-deep mt-0.5">
                Customers can book, but nothing can reach your bank until you finish with Stripe.
              </div>
            </div>
            <a
              href="/api/stripe/connect/start"
              className="flex-shrink-0 inline-flex items-center justify-center rounded-lg bg-merchant-chrome-mid text-white text-13 font-semibold px-3.5"
              style={{ minHeight: "38px" }}
            >
              Set up payouts
            </a>
          </div>
        ))}

      <div className="flex justify-end">
        <div className="inline-flex rounded-lg bg-merchant-fill-3 p-0.5">
          {PERIODS.map((p) => (
            <button
              key={p.days}
              onClick={() => setDays(p.days)}
              className={`rounded-md px-2.5 py-1 text-12 font-semibold transition-colors ${
                days === p.days ? "bg-white text-merchant-ink shadow-sm" : "text-merchant-muted"
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))" }}>
        <Card>
          <div className="p-3.5" style={{ borderLeft: "4px solid #0c5132" }}>
            <div className="text-13 text-merchant-muted">Earned</div>
            <div className="text-22 font-bold text-merchant-green tabular-nums mt-0.5">
              {totals ? dollars(totals.earnedCents) : "—"}
            </div>
            <div className="text-12 text-merchant-faint mt-0.5">
              {totals ? totals.earnedCount : 0} tickets · sailed, grace cleared
            </div>
          </div>
        </Card>
        <Card>
          <div className="p-3.5" style={{ borderLeft: "4px solid #303030" }}>
            <div className="text-13 text-merchant-muted">Held until they sail</div>
            <div className="text-22 font-bold text-merchant-ink tabular-nums mt-0.5">
              {totals ? dollars(totals.heldCents) : "—"}
            </div>
            <div className="text-12 text-merchant-faint mt-0.5">
              {totals ? totals.heldCount : 0} tickets · in the grace window
            </div>
          </div>
        </Card>
        <Card>
          <div className="p-3.5" style={{ borderLeft: "4px solid #8e1f0b" }}>
            <div className="text-13 text-merchant-muted">Given back</div>
            <div className="text-22 font-bold text-merchant-red tabular-nums mt-0.5">
              {totals ? dollars(totals.reversedCents) : "—"}
            </div>
            <div className="text-12 text-merchant-faint mt-0.5">
              {totals ? totals.reversedCount : 0} tickets · cancellations and refunds
            </div>
          </div>
        </Card>
      </div>

      <Card>
        {!revenue ? (
          <div className="px-4 py-8 text-center text-13 text-merchant-muted">Loading…</div>
        ) : revenue.trips.length === 0 ? (
          <div className="px-4 py-8 text-center text-13 text-merchant-muted">
            No trips in this period.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[620px] text-13">
              <thead>
                <tr className="bg-merchant-fill text-left">
                  {["Trip", "Earned", "Held", "Given back", "Status"].map((h) => (
                    <th key={h} className="px-4 py-2 text-12 font-semibold text-merchant-muted">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {revenue.trips.map((t) => (
                  <tr key={t.tripId} className="border-t border-merchant-hairline">
                    <td className="px-4 py-2.5 whitespace-nowrap">
                      <span className="inline-flex items-center gap-1.5">
                        <span className="w-2 h-2 rounded-full inline-block" style={{ backgroundColor: t.vesselColor }} />
                        <span className="font-semibold text-merchant-ink">{t.productName}</span>
                        <span className="text-merchant-faint">
                          {t.departureDate.slice(5)} · {fmtTimeET(t.startTime)}
                        </span>
                      </span>
                    </td>
                    <td className="px-4 py-2.5 tabular-nums text-merchant-green">
                      {t.earnedCents > 0 ? dollars(t.earnedCents) : "—"}
                    </td>
                    <td className="px-4 py-2.5 tabular-nums text-merchant-ink">
                      {t.heldCents > 0 ? dollars(t.heldCents) : "—"}
                    </td>
                    <td className="px-4 py-2.5 tabular-nums text-merchant-red">
                      {t.reversedCents > 0 ? dollars(t.reversedCents) : "—"}
                    </td>
                    <td className="px-4 py-2.5">
                      <LedgerStatusPill status={t.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
