"use client";

import { useEffect, useState, useCallback } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { fmtTimeET } from "@/lib/format";
import {
  Panel,
  Segmented,
  StatusLight,
  Lamp,
  useToast,
  useDensity,
  fmtMoney,
  ReadoutCell,
  ReadoutValue,
  ErrorState,
  EmptyState,
  LoadingState,
  BoatSwatch,
  ExternalIcon,
  type LightKind,
} from "@/components/admin/merchant";

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

const LEDGER_LIGHT: Record<RevenueTrip["status"], LightKind> = {
  scheduled: "coming-up",
  pending_settlement: "just-sailed",
  sailed: "sailed",
  cancelled: "cancelled",
};

/** "Oct 24". dateStr is YYYY-MM-DD. */
function fmtShortMonthDay(dateStr: string): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

export default function MoneyPage() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const { showToast } = useToast();
  const { density } = useDensity();

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
    else if (stripeParam === "cancelled") showToast("Stripe connection cancelled — payouts are still off.", "error");
    else if (stripeParam === "error") showToast("Something went wrong connecting Stripe. Try again.", "error");
    router.replace("/admin/money");
  }, [searchParams, announcedStripeParam, showToast, router]);

  const connected = !!operator?.stripeAccountId;
  const cellY = density === "dock" ? "py-3" : "py-1.5";
  const totals = revenue?.totals;

  const buckets = [
    {
      label: "Earned",
      lamp: <Lamp tone="go" />,
      cents: totals?.earnedCents,
      count: totals?.earnedCount ?? 0,
      sub: "sailed, grace cleared",
    },
    {
      label: "Held until they sail",
      lamp: <Lamp tone="ink" shape="hollow" />,
      cents: totals?.heldCents,
      count: totals?.heldCount ?? 0,
      sub: "in the grace window",
    },
    {
      label: "Given back",
      lamp: <Lamp tone="alert" />,
      cents: totals?.reversedCents,
      count: totals?.reversedCount ?? 0,
      sub: "cancellations and refunds",
    },
  ];

  const money = (cents: number, tone: "go" | "alert" | null) =>
    cents > 0 ? (
      <span className={tone === "go" ? "text-ob-go-ink" : tone === "alert" ? "text-ob-alert-ink" : ""}>{fmtMoney(cents)}</span>
    ) : (
      <span className="text-ob-ink-3">—</span>
    );

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <h1 className="text-title-page">Money</h1>
        <Segmented
          label="Period"
          size="dock"
          fill
          className="bg-ob-panel w-[420px] max-md:w-full"
          value={String(days)}
          onChange={(v) => setDays(Number(v))}
          options={PERIODS.map((p) => ({ value: String(p.days), label: p.label }))}
        />
      </div>

      {error ? (
        <ErrorState onRetry={() => load(days)} body={<>Money just can&rsquo;t load right now.</>} />
      ) : (
        <>
          {operator &&
            (connected ? (
              <div className="flex flex-wrap items-center gap-x-5 gap-y-3 px-5 py-4 bg-ob-panel border-2 border-ob-rule rounded-ob max-md:px-4">
                <div className="flex-[1_1_260px] min-w-0">
                  <div className="flex items-center gap-2.5 text-17 font-extrabold text-ob-go-ink">
                    <Lamp tone="go" />
                    Payouts are on
                  </div>
                  <div className="text-body-sm text-ob-ink-2">
                    Connected to Stripe account{" "}
                    <span className="font-num text-ob-ink [overflow-wrap:anywhere]">{operator.stripeAccountId}</span>.
                  </div>
                </div>
                <a
                  href="https://dashboard.stripe.com"
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center justify-center gap-2 min-h-tap-dock px-[18px] text-ob-ink border-2 border-ob-control rounded-ob text-body font-bold no-underline hover:bg-ob-panel-2 max-md:w-full"
                >
                  Open Stripe
                  <ExternalIcon />
                  <span className="sr-only">(opens in a new tab)</span>
                </a>
              </div>
            ) : (
              <div
                role="status"
                className="flex flex-wrap items-center gap-x-5 gap-y-3 px-5 py-4 bg-ob-caution-tint border-2 border-ob-caution rounded-ob max-md:px-4"
              >
                <div className="flex-[1_1_260px] min-w-0">
                  <div className="flex items-center gap-2.5 text-17 font-extrabold">
                    <Lamp tone="caution" />
                    Payouts aren&rsquo;t set up yet
                  </div>
                  <div className="text-body-sm text-ob-ink-2">
                    Customers can book, but nothing can reach your bank until you finish with Stripe.
                  </div>
                </div>
                <a
                  href="/api/stripe/connect/start"
                  className="inline-flex items-center justify-center min-h-tap-dock px-5 bg-ob-key text-ob-key-ink border-2 border-ob-key rounded-ob text-body font-bold no-underline hover:bg-ob-key-hover max-md:w-full"
                >
                  Set up payouts
                </a>
              </div>
            ))}

          <div className="grid grid-cols-3 max-lg:grid-cols-1 bg-ob-panel border-2 border-ob-rule rounded-ob overflow-hidden">
            {buckets.map((b) => (
              <ReadoutCell key={b.label}>
                <div className="flex items-center gap-2.5">
                  {b.lamp}
                  <span className="text-body font-bold">{b.label}</span>
                </div>
                <ReadoutValue className="mt-2">{b.cents === undefined ? "—" : fmtMoney(b.cents)}</ReadoutValue>
                <div className="text-body-sm text-ob-ink-2">
                  <span className="font-num text-ob-ink">{b.count}</span> tickets · {b.sub}
                </div>
              </ReadoutCell>
            ))}
          </div>

          <Panel aria-labelledby="mo-l">
            <div className="px-5 py-4 border-b-2 border-ob-rule max-md:px-4">
              <h2 id="mo-l" className="text-title-panel">
                Trip by trip
              </h2>
            </div>
            {!revenue ? (
              <LoadingState label="Loading…" rows={3} />
            ) : revenue.trips.length === 0 ? (
              <EmptyState title="No trips in this period." />
            ) : (
              <>
                <table className="w-full border-collapse text-body-sm max-md:hidden">
                  <thead>
                    <tr className="bg-ob-panel-2 text-left">
                      <th scope="col" className="py-2.5 pl-5 pr-3 text-meta font-bold text-ob-ink-2">Trip</th>
                      <th scope="col" className="py-2.5 px-3 text-meta font-bold text-ob-ink-2 text-right">Earned</th>
                      <th scope="col" className="py-2.5 px-3 text-meta font-bold text-ob-ink-2 text-right">Held</th>
                      <th scope="col" className="py-2.5 px-3 text-meta font-bold text-ob-ink-2 text-right">Given back</th>
                      <th scope="col" className="py-2.5 pl-3 pr-5 text-meta font-bold text-ob-ink-2">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {revenue.trips.map((t) => (
                      <tr key={t.tripId} className="border-t border-ob-hair">
                        <td className={`${cellY} pl-5 pr-3`}>
                          <div className="flex items-center gap-2.5">
                            <BoatSwatch color={t.vesselColor} />
                            <span className="font-bold">{t.productName}</span>
                            <span className="font-num text-ob-ink-2 whitespace-nowrap">
                              {fmtShortMonthDay(t.departureDate)} · {fmtTimeET(t.startTime)}
                            </span>
                          </div>
                        </td>
                        <td className={`${cellY} px-3 font-num text-right`}>{money(t.earnedCents, "go")}</td>
                        <td className={`${cellY} px-3 font-num text-right`}>{money(t.heldCents, null)}</td>
                        <td className={`${cellY} px-3 font-num text-right`}>{money(t.reversedCents, "alert")}</td>
                        <td className={`${cellY} pl-3 pr-5 whitespace-nowrap`}>
                          <StatusLight kind={LEDGER_LIGHT[t.status]} dense />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <div role="list" className="md:hidden">
                  {revenue.trips.map((t) => (
                    <div role="listitem" key={t.tripId} className="flex flex-col gap-1.5 px-4 py-3 border-t border-ob-hair first:border-t-0">
                      <div className="flex items-center justify-between gap-2.5">
                        <span className="flex items-center gap-2 min-w-0 text-body font-bold">
                          <BoatSwatch color={t.vesselColor} />
                          <span className="truncate">{t.productName}</span>
                        </span>
                        <StatusLight kind={LEDGER_LIGHT[t.status]} dense className="flex-none [&>span:last-child]:text-meta" />
                      </div>
                      <div className="font-num text-meta text-ob-ink-2">
                        {fmtShortMonthDay(t.departureDate)} · {fmtTimeET(t.startTime)}
                      </div>
                      <div className="grid grid-cols-3 gap-2 text-meta">
                        <div>
                          <div className="text-ob-ink-3">Earned</div>
                          <div className="font-num text-body">{money(t.earnedCents, "go")}</div>
                        </div>
                        <div>
                          <div className="text-ob-ink-3">Held</div>
                          <div className="font-num text-body">{money(t.heldCents, null)}</div>
                        </div>
                        <div>
                          <div className="text-ob-ink-3">Given back</div>
                          <div className="font-num text-body">{money(t.reversedCents, "alert")}</div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}
          </Panel>
        </>
      )}
    </div>
  );
}
