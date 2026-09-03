"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { dollars } from "@openboat/utils";
import { fmtTimeET } from "@/lib/format";

type TripFeeRow = {
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

type Totals = {
  earnedCents: number;
  heldCents: number;
  reversedCents: number;
  earnedCount: number;
  heldCount: number;
  reversedCount: number;
};

type ApiResponse = {
  fromDate: string;
  toDate: string;
  totals: Totals;
  trips: TripFeeRow[];
};

const RANGES = [
  { label: "30 days", days: 30 },
  { label: "90 days", days: 90 },
  { label: "12 months", days: 365 },
];

function fmtDate(date: string) {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

function toDateParam(days: number) {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

const STATUS_LABEL: Record<string, string> = {
  scheduled: "Scheduled",
  pending_settlement: "Pending",
  sailed: "Sailed",
  cancelled: "Cancelled",
};

const STATUS_COLOR: Record<string, string> = {
  scheduled: "bg-blue-100 text-blue-700",
  pending_settlement: "bg-yellow-100 text-yellow-700",
  sailed: "bg-green-100 text-green-700",
  cancelled: "bg-red-100 text-red-700",
};

function StatusBadge({ status }: { status: string }) {
  return (
    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_COLOR[status] ?? "bg-fill text-muted"}`}>
      {STATUS_LABEL[status] ?? status}
    </span>
  );
}

export default function RevenuePage() {
  const router = useRouter();
  const [data, setData] = useState<ApiResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [rangeDays, setRangeDays] = useState(90);

  const load = useCallback(
    async (days: number) => {
      setLoading(true);
      const from = toDateParam(days);
      const res = await fetch(`/api/admin/revenue?from=${from}`);
      if (res.status === 401) {
        router.push("/admin/login");
        return;
      }
      if (res.ok) setData(await res.json());
      setLoading(false);
    },
    [router],
  );

  useEffect(() => {
    load(rangeDays);
  }, [load, rangeDays]);

  const totals = data?.totals;
  const tripRows = data?.trips ?? [];

  return (
    <div className="max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-semibold text-ink">Revenue</h1>
          <p className="text-sm text-muted mt-0.5">Platform fee earnings by trip</p>
        </div>
        <div className="flex gap-1 bg-white border border-hairline rounded-lg p-1">
          {RANGES.map((r) => (
            <button
              key={r.days}
              onClick={() => setRangeDays(r.days)}
              className={`px-3 py-1 rounded-md text-sm font-medium transition-colors ${
                rangeDays === r.days
                  ? "bg-navy text-white shadow-sm"
                  : "text-muted hover:text-ink"
              }`}
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-6">
        <SummaryCard
          label="Earned"
          description="Sailed · grace cleared"
          cents={totals?.earnedCents ?? 0}
          count={totals?.earnedCount ?? 0}
          variant="earned"
          loading={loading}
        />
        <SummaryCard
          label="Held"
          description="In grace window"
          cents={totals?.heldCents ?? 0}
          count={totals?.heldCount ?? 0}
          variant="held"
          loading={loading}
        />
        <SummaryCard
          label="Reversed"
          description="Cancellations · refunds"
          cents={totals?.reversedCents ?? 0}
          count={totals?.reversedCount ?? 0}
          variant="reversed"
          loading={loading}
        />
      </div>

      {totals && totals.heldCents > 0 && (
        <p className="text-xs text-faint -mt-3 mb-5 text-right">
          Stripe balance includes {dollars(totals.heldCents)} held pending settlement.
        </p>
      )}

      {/* Per-trip breakdown */}
      {loading ? (
        <div className="text-center text-muted py-16 text-sm">Loading…</div>
      ) : tripRows.length === 0 ? (
        <div className="text-center text-muted py-16 text-sm">No trips with ticket sales in this period</div>
      ) : (
        <div className="bg-white rounded-xl border border-hairline overflow-hidden">
          <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-fill border-b border-hairline text-left">
                <th className="px-4 py-3 text-xs font-semibold text-muted uppercase tracking-label">Trip</th>
                <th className="px-4 py-3 text-xs font-semibold text-muted uppercase tracking-label text-right">Earned</th>
                <th className="px-4 py-3 text-xs font-semibold text-muted uppercase tracking-label text-right">Held</th>
                <th className="px-4 py-3 text-xs font-semibold text-muted uppercase tracking-label text-right">Reversed</th>
                <th className="px-4 py-3 text-xs font-semibold text-muted uppercase tracking-label text-right">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-hairline">
              {tripRows.map((row) => (
                <tr key={row.tripId} className="hover:bg-fill transition-colors">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <div className="w-1.5 h-8 rounded-full flex-shrink-0" style={{ backgroundColor: row.vesselColor }} />
                      <div>
                        <div className="font-medium text-ink">
                          {row.vesselName}
                          <span className="font-normal text-muted ml-1">· {row.productName}</span>
                        </div>
                        <div className="text-xs text-faint">
                          {fmtDate(row.departureDate)} {fmtTimeET(row.startTime)}
                        </div>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-right">
                    {row.earnedCents > 0 ? (
                      <span className="text-success font-medium">
                        {dollars(row.earnedCents)}
                        <span className="text-success/60 font-normal text-xs ml-1">×{row.earnedCount}</span>
                      </span>
                    ) : (
                      <span className="text-faint">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {row.heldCents > 0 ? (
                      <span className="text-amber font-medium">
                        {dollars(row.heldCents)}
                        <span className="text-amber/60 font-normal text-xs ml-1">×{row.heldCount}</span>
                      </span>
                    ) : (
                      <span className="text-faint">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {row.reversedCents > 0 ? (
                      <span className="text-warning font-medium">
                        −{dollars(row.reversedCents)}
                        <span className="text-warning/60 font-normal text-xs ml-1">×{row.reversedCount}</span>
                      </span>
                    ) : (
                      <span className="text-faint">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <StatusBadge status={row.status} />
                  </td>
                </tr>
              ))}
            </tbody>
            {totals && (
              <tfoot>
                <tr className="border-t-2 border-hairline bg-fill font-semibold">
                  <td className="px-4 py-3 text-ink text-sm">Total</td>
                  <td className="px-4 py-3 text-right text-success text-sm">{dollars(totals.earnedCents)}</td>
                  <td className="px-4 py-3 text-right text-amber text-sm">{dollars(totals.heldCents)}</td>
                  <td className="px-4 py-3 text-right text-warning text-sm">−{dollars(totals.reversedCents)}</td>
                  <td className="px-4 py-3" />
                </tr>
              </tfoot>
            )}
          </table>
          </div>
        </div>
      )}
    </div>
  );
}

function SummaryCard({
  label,
  description,
  cents,
  count,
  variant,
  loading,
}: {
  label: string;
  description: string;
  cents: number;
  count: number;
  variant: "earned" | "held" | "reversed";
  loading: boolean;
}) {
  const styles = {
    earned: { card: "bg-success-bg border-success/20", label: "text-success", amount: "text-success", sub: "text-success/70" },
    held: { card: "bg-white border-hairline", label: "text-amber", amount: "text-amber", sub: "text-muted" },
    reversed: { card: "bg-warning-bg border-warning/20", label: "text-warning", amount: "text-warning", sub: "text-warning/70" },
  }[variant];

  return (
    <div className={`rounded-xl border px-5 py-4 ${styles.card}`}>
      <div className={`text-xs font-semibold uppercase tracking-label mb-1 ${styles.label}`}>{label}</div>
      <div className={`text-2xl font-semibold ${styles.amount} ${loading ? "opacity-40" : ""}`}>
        {dollars(cents)}
      </div>
      <div className={`text-xs mt-0.5 ${styles.sub}`}>
        {count} ticket{count !== 1 ? "s" : ""} · {description}
      </div>
    </div>
  );
}
