import { db } from "@/lib/db";
import { fishingReports, trips, vessels, products, operators } from "@openboat/db";
import { and, desc, eq } from "drizzle-orm";
import Link from "next/link";
import type { Metadata } from "next";

export const revalidate = 300; // ISR: revalidate every 5 minutes

export const metadata: Metadata = {
  title: "Fishing Reports",
  description: "Recent catch reports from our fishing trips",
};

function fmtDate(date: string) {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

export default async function FishingReportsPage() {
  const [operator] = await db.select({ id: operators.id, name: operators.name }).from(operators).limit(1);
  if (!operator) return null;

  const rows = await db
    .select({
      id: fishingReports.id,
      catchSummary: fishingReports.catchSummary,
      fishCounts: fishingReports.fishCounts,
      photoUrls: fishingReports.photoUrls,
      createdAt: fishingReports.createdAt,
      departureDate: trips.departureDate,
      startTime: trips.startTime,
      vesselName: vessels.name,
      vesselColor: vessels.color,
      productName: products.displayName,
    })
    .from(fishingReports)
    .innerJoin(trips, eq(fishingReports.tripId, trips.id))
    .innerJoin(vessels, eq(fishingReports.vesselId, vessels.id))
    .innerJoin(products, eq(trips.productId, products.id))
    .where(eq(fishingReports.operatorId, operator.id))
    .orderBy(desc(fishingReports.createdAt))
    .limit(20);

  return (
    <main className="max-w-3xl mx-auto px-4 py-10">
      <h1 className="text-3xl font-bold text-gray-900 mb-2">Fishing Reports</h1>
      <p className="text-gray-500 mb-8">See what&apos;s been biting on recent trips.</p>

      {rows.length === 0 ? (
        <p className="text-gray-400 text-center py-16">No reports posted yet.</p>
      ) : (
        <div className="space-y-5">
          {rows.map((r) => (
            <Link
              key={r.id}
              href={`/fishing-reports/${r.id}`}
              className="block bg-white rounded-xl border border-gray-200 p-5 hover:shadow-md transition-shadow"
            >
              <div className="flex items-center gap-3 mb-3">
                <div
                  className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                  style={{ backgroundColor: r.vesselColor }}
                />
                <span className="font-semibold text-gray-900">{r.vesselName}</span>
                <span className="text-gray-400 text-sm">·</span>
                <span className="text-gray-500 text-sm">{r.productName}</span>
              </div>
              <p className="text-sm text-gray-500 mb-2">{fmtDate(r.departureDate)}</p>

              {r.catchSummary && (
                <p className="text-gray-700 text-sm line-clamp-3 mb-3">{r.catchSummary}</p>
              )}

              {(r.fishCounts as { species: string; count: number }[]).length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {(r.fishCounts as { species: string; count: number }[]).map((fc, i) => (
                    <span
                      key={i}
                      className="text-xs bg-blue-50 text-blue-700 font-medium px-2 py-0.5 rounded-full"
                    >
                      {fc.count} {fc.species}
                    </span>
                  ))}
                </div>
              )}

              {r.photoUrls.length > 0 && (
                <p className="text-xs text-gray-400 mt-2">{r.photoUrls.length} photo{r.photoUrls.length !== 1 ? "s" : ""}</p>
              )}
            </Link>
          ))}
        </div>
      )}
    </main>
  );
}
