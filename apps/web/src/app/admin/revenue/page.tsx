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
  { label: "Last 30 days", days: 30 },
  { label: "Last 90 days", days: 90 },
  { label: "Last 12 months", days: 365 },
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
        <h1 className="text-2xl font-semibold text-gray-900">Revenue</h1>
        <div className="flex gap-1 bg-gray-100 rounded-lg p-1 text-sm">
          {RANGES.map((r) => (
            <button
              key={r.days}
              onClick={() => setRangeDays(r.days)}
              className={`px-3 py-1 rounded-md transition-colors ${
                rangeDays === r.days
                  ? "bg-white shadow-sm text-gray-900 font-medium"
                  : "text-gray-500 hover:text-gray-700"
              }`}
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-3 gap-4 mb-8">
        <SummaryCard
          label="Earned"
          description="Trips sailed · grace cleared"
          cents={totals?.earnedCents ?? 0}
          count={totals?.earnedCount ?? 0}
          color="green"
          loading={loading}
        />
        <SummaryCard
          label="Held"
          description="Trips in grace window"
          cents={totals?.heldCents ?? 0}
          count={totals?.heldCount ?? 0}
          color="yellow"
          loading={loading}
        />
        <SummaryCard
          label="Reversed"
          description="Cancellations · refunds"
          cents={totals?.reversedCents ?? 0}
          count={totals?.reversedCount ?? 0}
          color="red"
          loading={loading}
        />
      </div>

      {/* Note: Stripe's balance will differ from earned by held + reversed amounts */}
      {totals && totals.heldCents > 0 && (
        <p className="text-xs text-gray-400 -mt-6 mb-6 text-right">
          Stripe balance includes {dollars(totals.heldCents)} held that hasn't cleared the
          settlement grace window yet.
        </p>
      )}

      {/* Per-trip breakdown */}
      {loading ? (
        <div className="text-center text-gray-400 py-16">Loading…</div>
      ) : tripRows.length === 0 ? (
        <div className="text-center text-gray-400 py-16">
          No trips with ticket sales in this period
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200 text-left text-xs font-medium text-gray-500 uppercase tracking-wide">
                <th className="px-4 py-3">Trip</th>
                <th className="px-4 py-3 text-right">Earned</th>
                <th className="px-4 py-3 text-right">Held</th>
                <th className="px-4 py-3 text-right">Reversed</th>
                <th className="px-4 py-3 text-right">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {tripRows.map((row) => (
                <tr key={row.tripId} className="hover:bg-gray-50 transition-colors">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <div
                        className="w-2 h-6 rounded-full flex-shrink-0"
                        style={{ backgroundColor: row.vesselColor }}
                      />
                      <div>
                        <div className="font-medium text-gray-900">
                          {row.vesselName}
                          <span className="font-normal text-gray-400 ml-1">
                            · {row.productName}
                          </span>
                        </div>
                        <div className="text-xs text-gray-400">
                          {fmtDate(row.departureDate)} {fmtTimeET(row.startTime)}
                        </div>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-right">
                    {row.earnedCents > 0 ? (
                      <span className="text-green-700 font-medium">
                        {dollars(row.earnedCents)}
                        <span className="text-green-400 font-normal text-xs ml-1">
                          ×{row.earnedCount}
                        </span>
                      </span>
                    ) : (
                      <span className="text-gray-300">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {row.heldCents > 0 ? (
                      <span className="text-yellow-600 font-medium">
                        {dollars(row.heldCents)}
                        <span className="text-yellow-400 font-normal text-xs ml-1">
                          ×{row.heldCount}
                        </span>
                      </span>
                    ) : (
                      <span className="text-gray-300">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {row.reversedCents > 0 ? (
                      <span className="text-red-600 font-medium">
                        −{dollars(row.reversedCents)}
                        <span className="text-red-400 font-normal text-xs ml-1">
                          ×{row.reversedCount}
                        </span>
                      </span>
                    ) : (
                      <span className="text-gray-300">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <StatusBadge status={row.status} />
                  </td>
                </tr>
              ))}
            </tbody>
            {/* Totals footer */}
            {totals && (
              <tfoot>
                <tr className="border-t-2 border-gray-200 bg-gray-50 font-medium">
                  <td className="px-4 py-3 text-gray-700">Total</td>
                  <td className="px-4 py-3 text-right text-green-700">
                    {dollars(totals.earnedCents)}
                  </td>
                  <td className="px-4 py-3 text-right text-yellow-600">
                    {dollars(totals.heldCents)}
                  </td>
                  <td className="px-4 py-3 text-right text-red-600">
                    −{dollars(totals.reversedCents)}
                  </td>
                  <td className="px-4 py-3" />
                </tr>
              </tfoot>
            )}
          </table>
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
  color,
  loading,
}: {
  label: string;
  description: string;
  cents: number;
  count: number;
  color: "green" | "yellow" | "red";
  loading: boolean;
}) {
  const colors = {
    green: {
      card: "border-green-100 bg-green-50",
      amount: "text-green-800",
      sub: "text-green-500",
    },
    yellow: {
      card: "border-yellow-100 bg-yellow-50",
      amount: "text-yellow-800",
      sub: "text-yellow-500",
    },
    red: { card: "border-red-100 bg-red-50", amount: "text-red-800", sub: "text-red-500" },
  }[color];

  return (
    <div className={`rounded-xl border p-5 ${colors.card}`}>
      <div className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">{label}</div>
      <div className={`text-2xl font-semibold ${colors.amount} ${loading ? "opacity-40" : ""}`}>
        {dollars(cents)}
      </div>
      <div className={`text-xs mt-1 ${colors.sub}`}>
        {count} ticket{count !== 1 ? "s" : ""} · {description}
      </div>
    </div>
  );
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
    <span
      className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_COLOR[status] ?? "bg-gray-100 text-gray-600"}`}
    >
      {STATUS_LABEL[status] ?? status}
    </span>
  );
}
