export const dynamic = "force-dynamic";

import { getOperatorRecord } from "@/lib/operator";
import { db } from "@/lib/db";
import { products, productPrices, fishingReports, trips, vessels } from "@openboat/db";
import { and, eq, ne, desc, gte, lte } from "drizzle-orm";
import Image from "next/image";
import Link from "next/link";
import { fmtTimeET } from "@/lib/format";

function dollars(cents: number) {
  return `$${Math.round(cents / 100)}`;
}

function fmtSailDate(dateStr: string) {
  const dt = new Date(dateStr + "T12:00:00Z");
  const dow = dt.toLocaleDateString("en-US", { weekday: "short", timeZone: "UTC" }).toUpperCase();
  const day = dt.getUTCDate();
  return { dow, day };
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

  const dayChips = Array.from({ length: 5 }, (_, i) => {
    const d = new Date(now.getTime() + i * 86400000);
    return d.toLocaleDateString("en-CA", { timeZone: "America/New_York" });
  });

  const [weekTripRows, latestReportRows, priceRows, categoryRows] = await Promise.all([
    db
      .select({
        tripId: trips.id,
        departureDate: trips.departureDate,
        startTime: trips.startTime,
        productName: products.displayName,
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
  const tripMap = new Map<string, { tripId: string; departureDate: string; startTime: Date; productName: string; seatsRemaining: number; minCents: number | null }>();
  for (const row of weekTripRows) {
    const existing = tripMap.get(row.tripId);
    if (!existing) {
      tripMap.set(row.tripId, {
        tripId: row.tripId,
        departureDate: row.departureDate,
        startTime: row.startTime,
        productName: row.productName,
        seatsRemaining: row.seatsRemaining,
        minCents: row.priceCents,
      });
    } else if (row.priceCents !== null && (existing.minCents === null || row.priceCents < existing.minCents)) {
      existing.minCents = row.priceCents;
    }
  }
  const sailings = Array.from(tripMap.values());

  const allPriceCents = priceRows.map((r) => r.priceCents);
  const fromPrice = allPriceCents.length > 0 ? Math.min(...allPriceCents) : null;
  const categories = categoryRows.map((r) => r.category);
  const latestReport = latestReportRows[0] ?? null;
  const operatorName = operator.name ?? "Fishing Charter";

  const datesWithTrips = new Set(sailings.map((t) => t.departureDate));

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
      {/* ── Utility strip ──────────────────────────────────────── */}
      <div
        className="bg-hull font-plex-mono text-[12px] tracking-[.1em] flex flex-wrap gap-3 justify-between"
        style={{ padding: "9px 28px", color: "#8fa3ad" }}
      >
        <span>{operator.dockAddress ?? ""}</span>
        <span className="flex gap-[22px]">
          <span>USCG CERTIFIED</span>
          {operator.phone && (
            <a href={`tel:${operator.phone}`} style={{ color: "#dfe8ec" }}>
              {operator.phone}
            </a>
          )}
        </span>
      </div>

      {/* ── Nav ────────────────────────────────────────────────── */}
      <div
        className="bg-hull flex flex-wrap gap-[18px] items-center justify-between"
        style={{ borderBottom: "3px solid #d1541f", padding: "16px 28px" }}
      >
        <Link
          href="/"
          className="font-archivo text-[24px] font-bold tracking-[.05em] text-white uppercase"
          style={{ textDecoration: "none" }}
        >
          {operatorName}
        </Link>
        <nav className="hidden md:flex flex-wrap gap-[26px] font-plex-mono text-[13px] font-semibold tracking-[.1em] uppercase">
          <a href="#sailings" className="text-white" style={{ textDecoration: "none" }}>Sailings</a>
          <a href="#species" style={{ color: "#b6c6ce", textDecoration: "none" }}>What we fish</a>
          <Link href="/fishing-reports" style={{ color: "#b6c6ce", textDecoration: "none" }}>Reports</Link>
          <a href="#boat" style={{ color: "#b6c6ce", textDecoration: "none" }}>The boat</a>
        </nav>
        <Link
          href="/book"
          className="bg-orange hover:bg-orange-press transition-colors font-plex-mono font-bold text-[13px] tracking-[.1em] uppercase text-white"
          style={{ padding: "13px 22px", textDecoration: "none" }}
        >
          Book a seat
        </Link>
      </div>

      {/* ── Hero ───────────────────────────────────────────────── */}
      <div
        style={{
          position: "relative",
          width: "100%",
          aspectRatio: "2 / 1",
          maxHeight: 660,
          background: "#0d1c26",
          overflow: "hidden",
        }}
      >
        <Image
          src="/hero-boat.png"
          alt={`${operatorName} fishing boat underway`}
          fill
          className="object-cover"
          priority
        />
        <div
          style={{
            position: "absolute",
            inset: 0,
            background:
              "linear-gradient(to top, rgba(13,28,38,.88) 0%, rgba(13,28,38,.66) 26%, rgba(13,28,38,.28) 46%, rgba(13,28,38,0) 64%)",
            pointerEvents: "none",
          }}
        />
        <div
          style={{ position: "absolute", inset: "auto 0 0 0", padding: "36px 28px", pointerEvents: "none" }}
        >
          <div
            className="inline-block bg-orange font-plex-mono text-[13px] tracking-[.2em] text-white"
            style={{ padding: "6px 12px", marginBottom: 14 }}
          >
            {fromPrice ? `FROM ${dollars(fromPrice)} PER ANGLER` : "PARTY FISHING DAILY"}
          </div>
          <div
            className="font-archivo font-bold text-white uppercase"
            style={{
              fontSize: "clamp(34px, 5.4vw, 66px)",
              lineHeight: 0.96,
              letterSpacing: "-.02em",
              maxWidth: "15ch",
            }}
          >
            A working boat, not a tour boat.
          </div>
        </div>
      </div>

      {/* ── Booking bar ────────────────────────────────────────── */}
      <div
        id="book"
        style={{
          position: "sticky",
          top: 0,
          zIndex: 20,
          background: "#16303f",
          padding: "20px 28px",
          boxShadow: "0 6px 18px rgba(13,28,38,.28)",
        }}
      >
        <div className="flex flex-wrap gap-6 items-end">
          {/* Day chips */}
          <div>
            <div
              className="font-plex-mono text-[11px] tracking-[.14em]"
              style={{ color: "#8fa3ad", marginBottom: 8 }}
            >
              DAY
            </div>
            <div className="flex flex-wrap gap-[6px]">
              {dayChips.map((dateStr, i) => {
                const { dow, day } = fmtSailDate(dateStr);
                const hasTrip = datesWithTrips.has(dateStr);
                const isFirst = i === 0;
                return (
                  <Link
                    key={dateStr}
                    href="/book"
                    className="text-center block"
                    style={{
                      background: isFirst ? "#d1541f" : "transparent",
                      border: isFirst ? "none" : "1px solid #3c5867",
                      color: hasTrip ? (isFirst ? "#fff" : "#dfe8ec") : "#6f8794",
                      padding: "9px 14px",
                      minWidth: 52,
                      textDecoration: "none",
                    }}
                  >
                    <div className="font-plex-mono" style={{ fontSize: 10 }}>{dow}</div>
                    <div className="font-archivo font-bold" style={{ fontSize: 20, lineHeight: 1 }}>{day}</div>
                  </Link>
                );
              })}
            </div>
          </div>

          {/* First available trip */}
          {sailings[0] && (
            <div className="flex-1 min-w-0">
              <div
                className="font-plex-mono text-[11px] tracking-[.14em]"
                style={{ color: "#8fa3ad", marginBottom: 8 }}
              >
                TRIP
              </div>
              <div
                className="bg-white flex flex-wrap gap-[10px] justify-between items-center"
                style={{ padding: "14px 16px" }}
              >
                <span className="font-archivo text-[16px] font-semibold">
                  {fmtTimeET(sailings[0].startTime)} · {sailings[0].productName}
                </span>
                {sailings[0].seatsRemaining > 0 && sailings[0].seatsRemaining <= 10 && (
                  <span className="font-plex-mono text-[13px] text-orange-press">
                    {sailings[0].seatsRemaining} SEATS LEFT ▾
                  </span>
                )}
              </div>
            </div>
          )}

          <Link
            href="/book"
            className="bg-orange hover:bg-orange-press transition-colors text-white font-archivo font-bold text-[15px] tracking-[.08em] uppercase"
            style={{ padding: "18px 28px", textDecoration: "none", flexShrink: 0 }}
          >
            Book now →
          </Link>
        </div>
      </div>

      {/* ── Reassurance strip ──────────────────────────────────── */}
      <div
        className="bg-hull font-plex-mono text-[12px] tracking-[.06em]"
        style={{ padding: "9px 28px", color: "#8fa3ad" }}
      >
        FREE CANCELLATION TO 24H · RODS &amp; BAIT ABOARD · WEATHER REFUNDS AUTOMATIC
      </div>

      {/* ── Sailings this week ─────────────────────────────────── */}
      {sailings.length > 0 && (
        <div id="sailings">
          <div
            style={{
              padding: "48px 28px 0",
              borderTop: "2px solid #cdd6da",
              display: "flex",
              flexWrap: "wrap",
              gap: 12,
              alignItems: "baseline",
              justifyContent: "space-between",
            }}
          >
            <h2
              className="font-archivo font-bold uppercase"
              style={{ margin: 0, fontSize: "clamp(26px, 3.4vw, 34px)", letterSpacing: "-.02em" }}
            >
              Everything sailing this week
            </h2>
            <span className="font-plex-mono text-[13px] text-ink-3">{weekLabel}</span>
          </div>

          <div style={{ padding: "20px 28px 0" }}>
            <div className="bg-white" style={{ border: "1px solid #cdd6da" }}>
              {/* Table header */}
              <div
                className="hidden sm:grid font-plex-mono text-[11px] tracking-[.12em] bg-hull"
                style={{
                  gridTemplateColumns: "120px minmax(0,1fr) 120px 100px 130px 130px",
                  gap: 16,
                  padding: "11px 20px",
                  color: "#8fa3ad",
                  alignItems: "center",
                }}
              >
                <span>DATE</span>
                <span>TRIP</span>
                <span>DEPARTS</span>
                <span>FARE</span>
                <span>SEATS</span>
                <span />
              </div>

              {sailings.map((trip, i) => {
                const soldOut = trip.seatsRemaining === 0;
                const fewLeft = !soldOut && trip.seatsRemaining <= 10;
                const seatLabel = soldOut
                  ? "SOLD OUT"
                  : fewLeft
                  ? `${trip.seatsRemaining} LEFT`
                  : "OPEN";
                const seatColor = soldOut
                  ? "#9aa8ae"
                  : fewLeft
                  ? "#8c3b12"
                  : "#186a4a";

                return (
                  <div
                    key={trip.tripId}
                    className="sm:grid"
                    style={{
                      gridTemplateColumns: "120px minmax(0,1fr) 120px 100px 130px 130px",
                      gap: 16,
                      padding: "16px 20px",
                      borderTop: i === 0 ? "1px solid #e3e9eb" : "1px solid #e3e9eb",
                      alignItems: "center",
                      background: soldOut ? "#f1f4f5" : "transparent",
                    }}
                  >
                    <span
                      className="font-plex-mono text-[14px]"
                      style={{ color: soldOut ? "#9aa8ae" : "#5b6f79" }}
                    >
                      {fmtSailDateShort(trip.departureDate)}
                    </span>
                    <span
                      className="font-archivo text-[17px] font-semibold block mt-2 sm:mt-0"
                      style={{ color: soldOut ? "#9aa8ae" : undefined }}
                    >
                      {trip.productName}
                    </span>
                    <span
                      className="font-plex-mono text-[14px] block mt-1 sm:mt-0"
                      style={{ color: soldOut ? "#9aa8ae" : "#5b6f79" }}
                    >
                      {fmtTimeET(trip.startTime)}
                    </span>
                    <span
                      className="font-plex-mono text-[17px] font-semibold block mt-1 sm:mt-0"
                      style={{ color: soldOut ? "#9aa8ae" : undefined }}
                    >
                      {trip.minCents != null ? dollars(trip.minCents) : "—"}
                    </span>
                    <span
                      className="font-plex-mono text-[13px] font-semibold block mt-1 sm:mt-0"
                      style={{ color: seatColor }}
                    >
                      {seatLabel}
                    </span>
                    <div className="flex justify-start sm:justify-end mt-2 sm:mt-0">
                      {soldOut ? (
                        <Link
                          href="/book"
                          className="font-plex-mono text-[12px] font-bold tracking-[.1em] text-ink-2"
                          style={{ border: "1px solid #9aa8ae", padding: "10px 16px", textDecoration: "none" }}
                        >
                          WAITLIST
                        </Link>
                      ) : (
                        <Link
                          href="/book"
                          className="bg-hull hover:bg-hull-2 transition-colors text-white font-plex-mono text-[12px] font-bold tracking-[.1em]"
                          style={{ padding: "11px 22px", textDecoration: "none" }}
                        >
                          BOOK
                        </Link>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* ── Calendar CTA band ──────────────────────────────────── */}
      <div
        className="bg-hull flex flex-wrap gap-6 items-center justify-between"
        style={{ margin: "28px 28px 0", borderLeft: "8px solid #d1541f", padding: 32 }}
      >
        <div className="min-w-0">
          <div
            className="font-archivo font-bold text-white uppercase"
            style={{ fontSize: "clamp(24px, 3.2vw, 32px)", letterSpacing: "-.01em" }}
          >
            Planning further out?
          </div>
          <div
            className="font-archivo text-[16px]"
            style={{ marginTop: 8, color: "#8fa3ad", maxWidth: "56ch" }}
          >
            Every sailing through the end of the season — species runs, tides and open seats, all on one calendar.
          </div>
        </div>
        <Link
          href="/book"
          className="bg-orange hover:bg-orange-press transition-colors text-white font-plex-mono font-bold text-[15px] tracking-[.1em] uppercase"
          style={{ padding: "18px 30px", textDecoration: "none", flexShrink: 0 }}
        >
          See the full calendar →
        </Link>
      </div>

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
                gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))",
                gap: 2,
                background: "#cdd6da",
              }}
            >
              {categories.map((cat) => (
                <Link
                  key={cat}
                  href="/book"
                  className="bg-deck hover:bg-deck-2 transition-colors"
                  style={{ padding: "16px 14px", textDecoration: "none" }}
                >
                  <div
                    className="font-archivo font-bold uppercase text-[15px]"
                    style={{ color: "#0d1c26" }}
                  >
                    {cat}
                  </div>
                  <div className="font-plex-mono text-[12px] text-ink-3" style={{ marginTop: 4 }}>
                    BOOK NOW →
                  </div>
                </Link>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ── Boat / crew split ──────────────────────────────────── */}
      <div
        id="boat"
        className="grid grid-cols-1 sm:grid-cols-2"
        style={{ marginTop: 52, borderTop: "1px solid #cdd6da" }}
      >
        <div
          className="min-w-0 bg-hull"
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
          style={{ padding: "48px 28px", color: "#dfe8ec" }}
        >
          <div
            className="font-plex-mono text-[12px] tracking-[.18em]"
            style={{ color: "#ff8a5c" }}
          >
            THE BOAT &amp; THE CREW
          </div>
          <h2
            className="font-archivo font-bold uppercase text-white"
            style={{
              margin: "16px 0 0",
              fontSize: "clamp(26px, 3.4vw, 38px)",
              lineHeight: 1.02,
            }}
          >
            Party fishing,<br />done right.
          </h2>
          <p
            className="font-archivo text-[17px]"
            style={{
              lineHeight: 1.6,
              maxWidth: "56ch",
              margin: "18px 0 0",
              color: "#b6c6ce",
            }}
          >
            Heated cabin, clean head, full galley, and a mate who will bait your hook, untangle your line and gaff your fish. First-timers and kids are the easiest people we carry — you need a jacket and nothing else.
          </p>
          <div
            className="flex flex-wrap gap-2 font-plex-mono text-[12px] tracking-[.08em]"
            style={{ marginTop: 24 }}
          >
            {["USCG CERTIFIED", "RODS & BAIT ABOARD", "FREE PARKING", "KIDS WELCOME"].map((tag) => (
              <span
                key={tag}
                style={{ border: "1px solid #3c5867", padding: "8px 12px", color: "#dfe8ec" }}
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
          className="grid grid-cols-1 sm:grid-cols-2"
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
              color: "#0d1c26",
              padding: "18px 28px",
              textDecoration: "none",
            }}
          >
            Book a seat →
          </Link>
        </div>
      </div>

      {/* ── Footer ─────────────────────────────────────────────── */}
      <div
        className="bg-hull"
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))",
          gap: 28,
          padding: "44px 28px",
          color: "#8fa3ad",
          fontSize: 14,
          lineHeight: 2,
        }}
      >
        <div>
          <div
            className="font-archivo font-bold uppercase text-white"
            style={{ fontSize: 20, letterSpacing: ".04em" }}
          >
            {operatorName}
          </div>
          <div style={{ lineHeight: 1.7, marginTop: 10 }}>
            {operator.dockAddress && <div>{operator.dockAddress}</div>}
            {operator.phone && (
              <a href={`tel:${operator.phone}`} style={{ color: "#b6c6ce", textDecoration: "none" }}>
                {operator.phone}
              </a>
            )}
          </div>
        </div>
        <div className="flex flex-col gap-1">
          <span className="font-plex-mono text-[11px] tracking-[.14em] text-ink-3">BOOK</span>
          <Link href="/book" style={{ color: "#b6c6ce", textDecoration: "none" }}>Full calendar</Link>
          <Link href="/book" style={{ color: "#b6c6ce", textDecoration: "none" }}>View trips</Link>
        </div>
        <div className="flex flex-col gap-1">
          <span className="font-plex-mono text-[11px] tracking-[.14em] text-ink-3">ON THE WATER</span>
          <Link href="/fishing-reports" style={{ color: "#b6c6ce", textDecoration: "none" }}>Fishing reports</Link>
        </div>
        <div className="flex flex-col gap-1">
          <span className="font-plex-mono text-[11px] tracking-[.14em] text-ink-3">POLICIES</span>
          <Link href="/terms" style={{ color: "#b6c6ce", textDecoration: "none" }}>Terms &amp; conditions</Link>
        </div>
      </div>

      {/* ── Copyright ──────────────────────────────────────────── */}
      <div
        className="font-plex-mono text-[11px] tracking-[.08em] flex flex-wrap gap-4 justify-between"
        style={{
          background: "#0a161e",
          color: "#5b6f79",
          padding: "16px 28px",
        }}
      >
        <span>© {new Date().getFullYear()} {operatorName.toUpperCase()} · USCG CERTIFIED &amp; INSPECTED</span>
        <span>TERMS · PRIVACY · CANCELLATION POLICY</span>
      </div>
    </div>
  );
}
