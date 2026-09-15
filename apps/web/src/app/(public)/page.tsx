export const dynamic = "force-dynamic";

import { getOperatorRecord } from "@/lib/operator";
import { db } from "@/lib/db";
import { products, productPrices, fishingReports, trips, vessels } from "@openboat/db";
import { and, eq, ne, desc, gte, lte } from "drizzle-orm";
import Image from "next/image";
import Link from "next/link";
import { fmtTimeET } from "@/lib/format";
import { SailingsSection } from "@/components/SailingsSection";
import type { FormattedSailing } from "@/components/SailingsSection";
import { SiteHeader } from "@/components/SiteHeader";

function fishImagePath(category: string): string | null {
  const lower = category.toLowerCase();
  if (lower.includes("bluefish")) return "/fish-images/bluefish.jpeg";
  if (lower.includes("sea bass") || lower.includes("bsb")) return "/fish-images/bsb.jpeg";
  if (lower.includes("blackfish") || lower.includes("tautog")) return "/fish-images/tautog.jpeg";
  if (lower.includes("striper") || lower.includes("striped bass")) return "/fish-images/striper.jpeg";
  if (lower.includes("fluke")) return "/fish-images/fluke.jpeg";
  return null;
}

function fmtSailDateShort(dateStr: string) {
  const dt = new Date(dateStr + "T12:00:00Z");
  const dow = dt.toLocaleDateString("en-US", { weekday: "short", timeZone: "UTC" }).toUpperCase();
  const day = dt.getUTCDate();
  return `${dow} ${day}`;
}

function fmtReportDate(dateStr: string) {
  const dt = new Date(dateStr + "T12:00:00Z");
  return dt.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" }).toUpperCase();
}

export default async function HomePage() {
  const operator = await getOperatorRecord();
  if (!operator) return null;

  const now = new Date();
  const todayStr = now.toLocaleDateString("en-CA", { timeZone: "America/New_York" });
  const weekEndDate = new Date(now.getTime() + 7 * 86400000);
  const weekEndStr = weekEndDate.toLocaleDateString("en-CA", { timeZone: "America/New_York" });

  const weekDates = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(now.getTime() + i * 86400000);
    return d.toLocaleDateString("en-CA", { timeZone: "America/New_York" });
  });

  const [weekTripRows, latestReportRows, , categoryRows] = await Promise.all([
    db
      .select({
        tripId: trips.id,
        departureDate: trips.departureDate,
        startTime: trips.startTime,
        endTime: trips.endTime,
        productName: products.displayName,
        category: products.category,
        seatsRemaining: trips.seatsRemaining,
        priceCents: productPrices.priceCents,
      })
      .from(trips)
      .innerJoin(products, eq(products.id, trips.productId))
      .leftJoin(
        productPrices,
        and(eq(productPrices.productId, products.id), eq(productPrices.active, true)),
      )
      .where(
        and(
          eq(trips.operatorId, operator.id),
          eq(trips.status, "scheduled"),
          gte(trips.departureDate, todayStr),
          lte(trips.departureDate, weekEndStr),
        ),
      )
      .orderBy(trips.departureDate, trips.startTime)
      .limit(50),

    db
      .select({
        id: fishingReports.id,
        catchSummary: fishingReports.catchSummary,
        departureDate: trips.departureDate,
        vesselName: vessels.name,
        photoUrls: fishingReports.photoUrls,
      })
      .from(fishingReports)
      .innerJoin(trips, eq(fishingReports.tripId, trips.id))
      .innerJoin(vessels, eq(fishingReports.vesselId, vessels.id))
      .where(eq(fishingReports.operatorId, operator.id))
      .orderBy(desc(fishingReports.createdAt))
      .limit(1),

    db
      .select({ priceCents: productPrices.priceCents })
      .from(productPrices)
      .innerJoin(products, eq(productPrices.productId, products.id))
      .where(and(eq(products.operatorId, operator.id), eq(productPrices.active, true))),

    db
      .select({ category: products.category })
      .from(products)
      .where(and(eq(products.operatorId, operator.id), ne(products.category, "Fireworks")))
      .groupBy(products.category)
      .orderBy(products.category),
  ]);

  // De-duplicate week trips and compute min price per trip
  const tripMap = new Map<string, { tripId: string; departureDate: string; startTime: Date; endTime: Date; productName: string; category: string; seatsRemaining: number; minCents: number | null }>();
  for (const row of weekTripRows) {
    const existing = tripMap.get(row.tripId);
    if (!existing) {
      tripMap.set(row.tripId, {
        tripId: row.tripId,
        departureDate: row.departureDate,
        startTime: row.startTime,
        endTime: row.endTime,
        productName: row.productName,
        category: row.category ?? "",
        seatsRemaining: row.seatsRemaining,
        minCents: row.priceCents,
      });
    } else if (row.priceCents !== null && (existing.minCents === null || row.priceCents < existing.minCents)) {
      existing.minCents = row.priceCents;
    }
  }

  function tripTypeFromCategory(cat: string): { color: string; label: string } {
    const lower = cat.toLowerCase();
    if (lower.includes("overnight") || lower.includes("night")) return { color: "#8c3b12", label: "OVERNIGHT" };
    if (lower.includes("offshore") || lower.includes("deep") || lower.includes("sea bass") || lower.includes("canyon")) return { color: "#245e78", label: "OFFSHORE" };
    return { color: "#186a4a", label: "BAY" };
  }

  function fmtDurationHp(startIso: Date, endIso: Date): string {
    const diffMs = endIso.getTime() - startIso.getTime();
    const hrs = Math.round(diffMs / 3600000);
    return hrs === 1 ? "1 HR" : `${hrs} HR`;
  }

  const formattedSailings: FormattedSailing[] = Array.from(tripMap.values()).map((s) => {
    const { color, label } = tripTypeFromCategory(s.category);
    return {
      tripId: s.tripId,
      departureDate: s.departureDate,
      productName: s.productName,
      category: s.category,
      tripTypeColor: color,
      tripTypeLabel: label,
      durationLabel: fmtDurationHp(s.startTime, s.endTime),
      seatsRemaining: s.seatsRemaining,
      minCents: s.minCents,
      startTimeFormatted: fmtTimeET(s.startTime),
      departureDateFormatted: fmtSailDateShort(s.departureDate),
    };
  });

  const categories = categoryRows.map((r) => r.category);
  const latestReport = latestReportRows[0] ?? null;
  const operatorName = operator.name ?? "Fishing Charter";

  const weekStart = new Date(todayStr + "T12:00:00Z").toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" }).toUpperCase();
  const weekEndLabel = new Date(weekEndStr + "T12:00:00Z").toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" }).toUpperCase();
  const weekLabel = `${weekStart} — ${weekEndLabel}`;

  return (
    <div
      className="font-archivo"
      style={{
        maxWidth: 1440,
        margin: "0 auto",
        background: "#eef1f0",
        borderLeft: "2px solid #cdd6da",
        borderRight: "2px solid #cdd6da",
        overflow: "hidden",
      }}
    >
      <SiteHeader
        operatorName={operatorName}
        phone={operator.phone}
        dockAddress={operator.dockAddress}
      />

      {/* ── Hero ───────────────────────────────────────────────── */}
      <div
        style={{
          position: "relative",
          width: "100%",
          background: "#16354a",
          overflow: "hidden",
        }}
        className="hero-height"
      >
        <style>{`.hero-height { height: 186px; } @media (min-width: 1024px) { .hero-height { height: auto; aspect-ratio: 2 / 1; max-height: 660px; } }`}</style>
        <Image
          src="/hero-boat.png"
          alt={`${operatorName} fishing boat underway`}
          fill
          className="object-cover"
          style={{ objectPosition: "center 55%" }}
          priority
        />
        <div
          style={{
            position: "absolute",
            inset: 0,
            background:
              "linear-gradient(to top, rgba(13,28,38,.92) 0%, rgba(13,28,38,.55) 44%, rgba(13,28,38,0) 78%)",
            pointerEvents: "none",
          }}
        />
        <div
          style={{ position: "absolute", inset: "auto 0 0 0", padding: "16px 16px", pointerEvents: "none" }}
          className="lg:p-[36px_28px]"
        >
          <div
            className="inline-block bg-orange font-plex-mono font-medium text-white uppercase"
            style={{ fontSize: 11, letterSpacing: ".18em", padding: "5px 9px", marginBottom: 10 }}
          >
            PARTY FISHING DAILY
          </div>
          <div
            className="font-archivo font-extrabold text-white uppercase"
            style={{
              fontSize: "clamp(30px, 5.4vw, 66px)",
              lineHeight: 0.98,
              letterSpacing: "-.02em",
              maxWidth: "15ch",
            }}
          >
            A WORKING BOAT,<br />NOT A TOUR BOAT.
          </div>
        </div>
      </div>

      {/* ── Trust band ─────────────────────────────────────────── */}
      <div
        className="bg-hull font-plex-mono"
        style={{ padding: "9px 16px", color: "#c9d6dd", fontSize: 11, letterSpacing: ".05em", lineHeight: 1.7 }}
      >
        <span className="lg:hidden">FREE CANCELLATION TO 24H · RODS &amp; BAIT ABOARD<br />WEATHER REFUNDS AUTOMATIC</span>
        <span className="hidden lg:inline">FREE CANCELLATION TO 24H · RODS &amp; BAIT ABOARD · WEATHER REFUNDS AUTOMATIC</span>
      </div>

      {/* ── Sailings this week ─────────────────────────────────── */}
      {formattedSailings.length > 0 && (
        <SailingsSection
          sailings={formattedSailings}
          weekLabel={weekLabel}
          weekDates={weekDates}
        />
      )}

      {/* ── Calendar CTA band ──────────────────────────────────── */}
      <Link
        href="/book"
        className="bg-hull flex items-center justify-between hover:bg-hull-2 transition-colors"
        style={{ borderLeft: "8px solid #c94510", padding: "20px 18px", margin: "16px 16px 0", textDecoration: "none" }}
      >
        <span
          className="font-archivo font-bold text-white uppercase"
          style={{ fontSize: 16, letterSpacing: "-.01em" }}
        >
          FULL SEASON CALENDAR
        </span>
        <span style={{ color: "#ff8a5c", fontSize: 18 }}>→</span>
      </Link>

      {/* ── Species / categories ───────────────────────────────── */}
      {categories.length > 0 && (
        <div id="species">
          <div
            style={{
              padding: "52px 28px 16px",
              display: "flex",
              flexWrap: "wrap",
              gap: 12,
              alignItems: "baseline",
              justifyContent: "space-between",
            }}
          >
            <h2
              className="font-archivo font-bold uppercase"
              style={{ margin: 0, fontSize: "clamp(24px, 3vw, 30px)" }}
            >
              What we&apos;re on
            </h2>
            <span className="font-archivo text-[14px] text-ink-3">
              Open boat — you keep what you catch.
            </span>
          </div>
          <div style={{ padding: "0 28px" }}>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(6, minmax(0, 1fr))",
                gap: 2,
                background: "#cdd6da",
              }}
            >
              {categories.map((cat) => {
                const img = fishImagePath(cat);
                return (
                  <Link
                    key={cat}
                    href="/book"
                    className="relative overflow-hidden group"
                    style={{ aspectRatio: "4/3", display: "block", textDecoration: "none", background: "#16354a" }}
                  >
                    {img && (
                      <Image
                        src={img}
                        alt={cat}
                        fill
                        className="object-cover transition-transform duration-500 group-hover:scale-105"
                        sizes="(max-width: 768px) 50vw, 17vw"
                      />
                    )}
                    <div
                      className="absolute inset-0"
                      style={{ background: "linear-gradient(to top, rgba(13,28,38,.88) 0%, rgba(13,28,38,.3) 55%, rgba(13,28,38,0) 100%)" }}
                    />
                    <div className="absolute bottom-0 left-0 right-0" style={{ padding: "14px 14px 16px" }}>
                      <div className="font-archivo font-bold uppercase text-white" style={{ fontSize: 15 }}>
                        {cat}
                      </div>
                      <div className="font-plex-mono" style={{ fontSize: 11, letterSpacing: ".1em", color: "rgba(255,255,255,.65)", marginTop: 3 }}>
                        BOOK NOW →
                      </div>
                    </div>
                  </Link>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* ── Boat / crew split ──────────────────────────────────── */}
      <div
        id="boat"
        className="lg:grid lg:grid-cols-2"
        style={{ marginTop: 20, borderTop: "1px solid #cdd6da" }}
      >
        <div
          className="hidden lg:block min-w-0 bg-hull"
          style={{ minHeight: 320, position: "relative" }}
        >
          <Image
            src="/hero-boat.png"
            alt="The boat and crew"
            fill
            className="object-cover"
          />
        </div>
        <div
          className="min-w-0 bg-hull flex flex-col justify-center"
          style={{ padding: "24px 16px", color: "#dfe8ec" }}
        >
          <div
            className="font-plex-mono font-medium"
            style={{ fontSize: 10, letterSpacing: ".18em", color: "#ff8a5c" }}
          >
            THE BOAT &amp; THE CREW
          </div>
          <h2
            className="font-archivo font-bold uppercase text-white"
            style={{
              margin: "12px 0 0",
              fontSize: "clamp(22px, 3.4vw, 38px)",
              lineHeight: 1.02,
            }}
          >
            PARTY FISHING,<br />DONE RIGHT.
          </h2>
          <p
            className="font-archivo"
            style={{
              fontSize: 14,
              lineHeight: 1.6,
              maxWidth: "56ch",
              margin: "14px 0 0",
              color: "#b6c6ce",
            }}
          >
            Heated cabin, clean head, full galley, and a mate who will bait your hook, untangle your line and gaff your fish. First-timers and kids are the easiest people we carry — you need a jacket and nothing else.
          </p>
          <div
            className="flex flex-wrap gap-2 font-plex-mono"
            style={{ marginTop: 20, fontSize: 11, letterSpacing: ".08em" }}
          >
            {["USCG CERTIFIED", "FREE PARKING", "KIDS WELCOME"].map((tag) => (
              <span
                key={tag}
                style={{ border: "1px solid #3c5867", padding: "8px 10px", color: "#dfe8ec" }}
              >
                {tag}
              </span>
            ))}
          </div>
        </div>
      </div>

      {/* ── Latest report ──────────────────────────────────────── */}
      {latestReport && (
        <div
          id="report"
          className="lg:grid lg:grid-cols-2"
          style={{ borderTop: "1px solid #cdd6da" }}
        >
          <div className="min-w-0 flex flex-col justify-center" style={{ padding: "48px 28px" }}>
            <div
              className="font-plex-mono text-[12px] tracking-[.18em] text-orange-ink"
            >
              LATEST REPORT · {fmtReportDate(latestReport.departureDate)}
            </div>
            <h2
              className="font-archivo font-bold uppercase"
              style={{
                margin: "14px 0 0",
                fontSize: "clamp(24px, 3vw, 32px)",
                lineHeight: 1.1,
              }}
            >
              {latestReport.catchSummary?.slice(0, 80) ?? `${latestReport.vesselName} · Latest trip`}
            </h2>
            {latestReport.catchSummary && latestReport.catchSummary.length > 80 && (
              <p
                className="font-archivo text-[17px] text-ink-2"
                style={{ lineHeight: 1.6, maxWidth: "54ch", margin: "16px 0 0" }}
              >
                {latestReport.catchSummary.slice(80, 260)}
                {latestReport.catchSummary.length > 260 ? "…" : ""}
              </p>
            )}
            <div
              className="flex flex-wrap gap-[22px] font-plex-mono text-[12px] tracking-[.1em]"
              style={{ marginTop: 22 }}
            >
              <Link href="/fishing-reports" style={{ color: "#b1440f", textDecoration: "none" }}>
                ALL REPORTS →
              </Link>
              <Link href={`/fishing-reports/${latestReport.id}`} style={{ color: "#b1440f", textDecoration: "none" }}>
                FULL REPORT →
              </Link>
            </div>
          </div>
          <div
            className="min-w-0 bg-deck-2"
            style={{ minHeight: 360, position: "relative" }}
          >
            {latestReport.photoUrls.length > 0 ? (
              <Image
                src={latestReport.photoUrls[0]}
                alt="Recent catch"
                fill
                className="object-cover"
              />
            ) : (
              <div className="w-full h-full flex items-center justify-center">
                <span className="font-plex-mono text-[12px] tracking-[.1em] text-ink-3">PHOTO COMING SOON</span>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Orange CTA band ────────────────────────────────────── */}
      <div
        className="bg-orange text-white flex flex-wrap gap-6 items-center justify-between"
        style={{ padding: "52px 28px", borderTop: "1px solid #cdd6da" }}
      >
        <h2
          className="font-archivo font-bold uppercase text-white"
          style={{
            margin: 0,
            fontSize: "clamp(28px, 4.6vw, 54px)",
            lineHeight: 0.98,
            maxWidth: "18ch",
          }}
        >
          Bring a jacket.<br />We&apos;ve got the rest.
        </h2>
        <div className="flex flex-wrap gap-[14px] items-center">
          <Link
            href="/book"
            className="font-archivo font-bold text-[15px] tracking-[.08em] uppercase hover:opacity-90 transition-opacity"
            style={{
              background: "#fff",
              color: "#16354a",
              padding: "18px 28px",
              textDecoration: "none",
            }}
          >
            Book a seat →
          </Link>
        </div>
      </div>

      {/* ── Footer ─────────────────────────────────────────────── */}
      <div className="bg-hull" style={{ padding: "40px 24px", color: "#c9d6dd" }}>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-8 lg:gap-7">
          {/* Brand — full width on mobile, 1 col on desktop */}
          <div className="col-span-2 lg:col-span-1">
            <div
              className="font-archivo font-bold uppercase text-white"
              style={{ fontSize: 20, letterSpacing: ".04em" }}
            >
              {operatorName}
            </div>
            <div className="font-archivo" style={{ fontSize: 14, lineHeight: 1.8, marginTop: 10, color: "#b6c6ce" }}>
              {operator.dockAddress && <div>{operator.dockAddress}</div>}
              {operator.phone && (
                <a href={`tel:${operator.phone}`} style={{ color: "#b6c6ce", textDecoration: "none" }}>
                  {operator.phone}
                </a>
              )}
            </div>
          </div>

          {/* BOOK */}
          <div className="flex flex-col gap-[6px]">
            <span className="font-plex-mono text-[11px] tracking-[.14em]" style={{ color: "#c9d6dd", marginBottom: 4 }}>BOOK</span>
            <Link href="/book" className="font-archivo text-[14px]" style={{ color: "#b6c6ce", textDecoration: "none" }}>Full calendar</Link>
            <Link href="/book" className="font-archivo text-[14px]" style={{ color: "#b6c6ce", textDecoration: "none" }}>View trips</Link>
          </div>

          {/* ON THE WATER */}
          <div className="flex flex-col gap-[6px]">
            <span className="font-plex-mono text-[11px] tracking-[.14em]" style={{ color: "#c9d6dd", marginBottom: 4 }}>ON THE WATER</span>
            <Link href="/fishing-reports" className="font-archivo text-[14px]" style={{ color: "#b6c6ce", textDecoration: "none" }}>Fishing reports</Link>
          </div>

          {/* POLICIES */}
          <div className="flex flex-col gap-[6px]">
            <span className="font-plex-mono text-[11px] tracking-[.14em]" style={{ color: "#c9d6dd", marginBottom: 4 }}>POLICIES</span>
            <Link href="/terms" className="font-archivo text-[14px]" style={{ color: "#b6c6ce", textDecoration: "none" }}>Terms &amp; conditions</Link>
          </div>
        </div>
      </div>

      {/* ── Copyright ──────────────────────────────────────────── */}
      <div
        className="font-plex-mono text-[11px] tracking-[.08em] flex flex-wrap gap-3 justify-between"
        style={{
          background: "#102030",
          color: "#5b6f79",
          padding: "16px 24px",
        }}
      >
        <span>© {new Date().getFullYear()} {operatorName.toUpperCase()} · USCG CERTIFIED &amp; INSPECTED</span>
        <span>TERMS · PRIVACY · CANCELLATION POLICY</span>
      </div>
    </div>
  );
}
