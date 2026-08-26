import { db } from "@/lib/db";
import { fishingReports, trips, vessels, products, operators } from "@openboat/db";
import { fmtTimeET } from "@/lib/format";
import { and, eq } from "drizzle-orm";
import { getOperatorIdFromHeaders } from "@/lib/operator";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import Image from "next/image";

export const revalidate = 300;

type Props = { params: Promise<{ reportId: string }> };

async function fetchReport(reportId: string) {
  const operatorId = await getOperatorIdFromHeaders();
  const [operator] = operatorId
    ? await db
        .select({ id: operators.id, name: operators.name })
        .from(operators)
        .where(eq(operators.id, operatorId))
    : [];
  if (!operator) return null;

  const [row] = await db
    .select({
      id: fishingReports.id,
      catchSummary: fishingReports.catchSummary,
      fishCounts: fishingReports.fishCounts,
      photoUrls: fishingReports.photoUrls,
      createdAt: fishingReports.createdAt,
      departureDate: trips.departureDate,
      startTime: trips.startTime,
      endTime: trips.endTime,
      vesselName: vessels.name,
      vesselColor: vessels.color,
      vesselSlug: vessels.slug,
      productName: products.displayName,
      productCategory: products.category,
      operatorName: operators.name,
    })
    .from(fishingReports)
    .innerJoin(trips, eq(fishingReports.tripId, trips.id))
    .innerJoin(vessels, eq(fishingReports.vesselId, vessels.id))
    .innerJoin(products, eq(trips.productId, products.id))
    .innerJoin(operators, eq(fishingReports.operatorId, operators.id))
    .where(and(eq(fishingReports.id, reportId), eq(fishingReports.operatorId, operator.id)));

  return row ?? null;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { reportId } = await params;
  const row = await fetchReport(reportId);
  if (!row) return { title: "Report Not Found" };

  const [y, m, d] = row.departureDate.split("-").map(Number);
  const date = new Date(y, m - 1, d).toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });

  const counts = row.fishCounts as { species: string; count: number }[];
  const headline =
    counts.length > 0
      ? counts.map((fc) => `${fc.count} ${fc.species}`).join(", ")
      : (row.catchSummary?.slice(0, 80) ?? "Fishing Report");

  return {
    title: `${row.vesselName} · ${date} · ${headline}`,
    description:
      row.catchSummary?.slice(0, 160) ?? `Fishing report from ${row.vesselName} on ${date}`,
    openGraph: row.photoUrls.length > 0 ? { images: [row.photoUrls[0]] } : undefined,
  };
}

function fmtDate(date: string) {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}


export default async function FishingReportPage({ params }: Props) {
  const { reportId } = await params;
  const row = await fetchReport(reportId);
  if (!row) notFound();

  const fishCounts = row.fishCounts as { species: string; count: number }[];

  return (
    <main className="max-w-2xl mx-auto px-4 py-10">
      <Link
        href="/fishing-reports"
        className="text-sm text-muted hover:text-ink flex items-center gap-1 mb-6 transition-colors"
      >
        ← Fishing Reports
      </Link>

      <div className="flex items-center gap-3 mb-1">
        <div
          className="w-3 h-3 rounded-full flex-shrink-0"
          style={{ backgroundColor: row.vesselColor }}
        />
        <h1 className="text-2xl font-bold text-ink">{row.vesselName}</h1>
        <span className="text-faint">·</span>
        <span className="text-muted">{row.productName}</span>
      </div>
      <p className="text-muted text-sm mb-6">
        {fmtDate(row.departureDate)} · {fmtTimeET(row.startTime)} – {fmtTimeET(row.endTime)}
      </p>

      {fishCounts.length > 0 && (
        <div className="bg-teal-tint rounded-xl p-4 mb-6">
          <h2 className="text-xs font-semibold text-teal uppercase tracking-label mb-3">
            Today&apos;s Catch
          </h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {fishCounts.map((fc, i) => (
              <div key={i} className="bg-white rounded-lg p-3 text-center shadow-sm">
                <div className="text-2xl font-bold text-ink">{fc.count}</div>
                <div className="text-xs text-faint mt-0.5 capitalize">{fc.species}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {row.catchSummary && (
        <div className="mb-6">
          <h2 className="text-sm font-semibold text-ink mb-2">Captain&apos;s Report</h2>
          <p className="text-ink leading-relaxed whitespace-pre-wrap">{row.catchSummary}</p>
        </div>
      )}

      {row.photoUrls.length > 0 && (
        <div className="grid grid-cols-2 gap-3 mb-6">
          {row.photoUrls.map((url, i) => (
            <div key={i} className="relative aspect-square rounded-xl overflow-hidden bg-fill">
              <Image
                src={url}
                alt={`Trip photo ${i + 1}`}
                fill
                className="object-cover"
                sizes="(max-width: 640px) 50vw, 320px"
              />
            </div>
          ))}
        </div>
      )}

      <div className="border-t border-hairline pt-6">
        <Link
          href="/"
          className="inline-block bg-gold text-navy font-grotesk text-15 font-semibold px-5 py-2.5 rounded-btn hover:bg-gold-hover transition-colors"
        >
          Book a Trip
        </Link>
      </div>
    </main>
  );
}
