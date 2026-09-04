export const dynamic = "force-dynamic";

import { dollars } from "@openboat/utils";
import { getOperatorRecord } from "@/lib/operator";
import { db } from "@/lib/db";
import { products, productPrices, fishingReports, trips, vessels } from "@openboat/db";
import { and, eq, ne, desc } from "drizzle-orm";
import Image from "next/image";
import Link from "next/link";

// ─── Fish emoji map ───────────────────────────────────────────────────────────

const FISH_EMOJI: Record<string, string> = {
  Fluke: "🐟",
  "Fluke / Striper": "🎣",
  "Sea Bass": "🐠",
  "Sea Bass / Fluke": "🐠",
  "Striped Bass": "🎣",
  "Stripers and Blues": "🎣",
  Blackfish: "🐡",
  "Night Stripers": "🌙",
};
function fishEmoji(cat: string) {
  return FISH_EMOJI[cat] ?? "🎣";
}

// ─── HeroSection ─────────────────────────────────────────────────────────────

function HeroSection({
  operatorName,
  fromPrice,
  dockAddress,
}: {
  operatorName: string;
  fromPrice: number | null;
  dockAddress: string | null;
}) {
  const eyebrow = dockAddress?.toUpperCase() ?? "SPORT FISHING";

  return (
    <section className="relative overflow-hidden bg-navy">
      <div className="relative max-w-7xl mx-auto px-6 md:px-10 py-20 md:py-28">
        <div className="md:grid md:gap-10" style={{ gridTemplateColumns: "1.1fr 1fr" }}>
          {/* Left column */}
          <div className="flex flex-col justify-center">
            <p className="text-13 font-bold uppercase mb-4 text-gold tracking-[0.14em]">
              {eyebrow}
            </p>

            <h1 className="font-manrope text-36 md:text-48 font-extrabold text-white mb-4 leading-[1.08]">
              {operatorName}
            </h1>

            <p className="text-16 mb-6 text-white/70">
              Party fishing trips · Book your spot online
            </p>

            {/* Pill badges */}
            <div className="flex flex-wrap gap-2 mb-8">
              {[
                "⭐ Top-rated",
                "🎣 USCG Certified",
                ...(fromPrice !== null ? [`From ${dollars(fromPrice)} / ticket`] : []),
              ].map((label) => (
                <span
                  key={label}
                  className="text-13 font-medium px-3 py-1 rounded-full bg-white/8 text-gold-light border border-white/12"
                >
                  {label}
                </span>
              ))}
            </div>

            {/* CTAs */}
            <div className="flex flex-wrap gap-3">
              <Link
                href="/book"
                className="font-manrope text-15 font-bold px-6 py-3 rounded-[9px] bg-gold text-navy transition-opacity hover:opacity-90"
              >
                Book a trip →
              </Link>
              <Link
                href="/book"
                className="font-manrope text-15 font-bold px-6 py-3 rounded-[9px] text-white border border-white/35 transition-opacity hover:opacity-80"
              >
                View schedule →
              </Link>
            </div>
          </div>

          {/* Right column — framed photo (desktop only) */}
          <div className="hidden md:flex items-center justify-center relative">
            <div className="absolute inset-4 border border-gold/50 rounded-[20px] rotate-[1.5deg]" />
            <div className="relative w-full rounded-2xl overflow-hidden" style={{ aspectRatio: "4/3" }}>
              <Image
                src="/hero-boat.png"
                alt="Fishing boat with anglers at sea"
                fill
                className="object-cover"
                priority
              />
            </div>
            <div className="absolute -bottom-4 -left-4 bg-white px-4 py-3 rounded-xl shadow-hero">
              <div className="font-manrope text-20 font-extrabold text-navy">500+</div>
              <div className="text-12 font-medium text-muted">trips run</div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

// ─── TripCategoriesSection ────────────────────────────────────────────────────

function TripCategoriesSection({ categories }: { categories: string[] }) {
  if (categories.length === 0) return null;

  return (
    <section className="bg-white py-16 px-6">
      <div className="max-w-7xl mx-auto">
        <p className="text-13 font-bold uppercase tracking-[0.14em] text-gold mb-2">
          Trip Types
        </p>
        <h2 className="font-manrope text-28 md:text-36 font-extrabold text-ink mb-10">
          What&apos;s Biting
        </h2>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
          {categories.map((cat) => (
            <Link
              key={cat}
              href="/book"
              className="group flex flex-col items-center text-center bg-navy-tint rounded-card p-6 border border-transparent hover:border-gold/40 hover:shadow-card transition-all"
            >
              <span className="text-4xl mb-3">{fishEmoji(cat)}</span>
              <span className="font-manrope text-16 font-bold text-ink mb-1">{cat}</span>
              <span className="text-13 text-gold font-medium group-hover:underline">
                Book Now →
              </span>
            </Link>
          ))}
        </div>
      </div>
    </section>
  );
}

// ─── WhyUsSection ─────────────────────────────────────────────────────────────

const WHY_US = [
  {
    emoji: "🏅",
    title: "USCG Certified",
    body: "Licensed, inspected, and Coast Guard certified for your safety on the water.",
  },
  {
    emoji: "🧭",
    title: "Experienced Captains",
    body: "Decades of local knowledge and expert guidance on every trip.",
  },
  {
    emoji: "📱",
    title: "Easy Online Booking",
    body: "Reserve your spot in minutes, 24/7 — no phone calls needed.",
  },
];

function WhyUsSection() {
  return (
    <section className="bg-navy py-16 px-6">
      <div className="max-w-7xl mx-auto">
        <p className="text-13 font-bold uppercase tracking-[0.14em] text-gold mb-2">
          Why Book With Us
        </p>
        <h2 className="font-manrope text-28 md:text-36 font-extrabold text-white mb-10">
          The Best Day on the Water
        </h2>
        <div className="grid md:grid-cols-3 gap-8">
          {WHY_US.map((item) => (
            <div key={item.title} className="flex flex-col gap-3">
              <span className="text-4xl">{item.emoji}</span>
              <h3 className="font-manrope text-18 font-bold text-white">{item.title}</h3>
              <p className="text-15 text-white/65 leading-relaxed">{item.body}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

// ─── ReportsTeaserSection ─────────────────────────────────────────────────────

type ReportRow = {
  id: string;
  catchSummary: string | null;
  fishCounts: unknown;
  photoUrls: string[];
  departureDate: string;
  vesselName: string;
  vesselColor: string;
  productName: string;
};

function fmtDate(date: string) {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
}

function ReportsTeaserSection({ reports }: { reports: ReportRow[] }) {
  return (
    <section className="bg-surface py-16 px-6">
      <div className="max-w-7xl mx-auto">
        <div className="flex items-end justify-between mb-8 flex-wrap gap-4">
          <div>
            <p className="text-13 font-bold uppercase tracking-[0.14em] text-gold mb-2">
              Recent Activity
            </p>
            <h2 className="font-manrope text-28 md:text-36 font-extrabold text-ink">
              Latest from the Water
            </h2>
          </div>
          <Link
            href="/fishing-reports"
            className="text-14 font-semibold text-teal hover:text-teal-dark transition-colors"
          >
            See all reports →
          </Link>
        </div>
        <div className="grid md:grid-cols-3 gap-5">
          {reports.map((r) => (
            <Link
              key={r.id}
              href={`/fishing-reports/${r.id}`}
              className="block bg-white rounded-xl border border-card-border p-5 hover:shadow-card-selected transition-shadow"
            >
              <div className="flex items-center gap-2 mb-2">
                <div
                  className="w-2.5 h-2.5 rounded-full shrink-0"
                  style={{ backgroundColor: r.vesselColor }}
                />
                <span className="font-semibold text-ink text-14">{r.vesselName}</span>
                <span className="text-faint text-sm">·</span>
                <span className="text-muted text-13">{r.productName}</span>
              </div>
              <p className="text-12 text-muted mb-2">{fmtDate(r.departureDate)}</p>
              {r.catchSummary && (
                <p className="text-13 text-ink line-clamp-3">{r.catchSummary}</p>
              )}
              {(r.fishCounts as { species: string; count: number }[]).length > 0 && (
                <div className="flex flex-wrap gap-1.5 mt-3">
                  {(r.fishCounts as { species: string; count: number }[])
                    .slice(0, 3)
                    .map((fc, i) => (
                      <span
                        key={i}
                        className="text-11 bg-teal-tint text-teal font-medium px-2 py-0.5 rounded-full"
                      >
                        {fc.count} {fc.species}
                      </span>
                    ))}
                </div>
              )}
            </Link>
          ))}
        </div>
      </div>
    </section>
  );
}

// ─── Footer ───────────────────────────────────────────────────────────────────

function Footer({
  operatorName,
  dockAddress,
  phone,
}: {
  operatorName: string;
  dockAddress: string | null;
  phone: string | null;
}) {
  const year = new Date().getFullYear();

  return (
    <footer className="bg-navy-medium border-t border-white/10">
      <div className="max-w-7xl mx-auto px-6 py-12 grid md:grid-cols-2 gap-10">
        {/* Left: operator info */}
        <div>
          <p className="font-manrope text-18 font-bold text-white mb-3">{operatorName}</p>
          {dockAddress && (
            <p className="text-14 text-white/60 mb-1">{dockAddress}</p>
          )}
          {phone && (
            <a href={`tel:${phone}`} className="text-14 text-white/60 hover:text-white/80 transition-colors">
              {phone}
            </a>
          )}
        </div>

        {/* Right: quick links */}
        <div className="md:text-right">
          <p className="text-13 font-semibold uppercase tracking-label text-gold/80 mb-4">
            Quick Links
          </p>
          <nav className="flex flex-col md:items-end gap-2">
            <Link href="/" className="text-14 text-white/60 hover:text-white transition-colors">Home</Link>
            <Link href="/book" className="text-14 text-white/60 hover:text-white transition-colors">Book a Trip</Link>
            <Link href="/fishing-reports" className="text-14 text-white/60 hover:text-white transition-colors">Fishing Reports</Link>
            <Link href="/terms" className="text-14 text-white/60 hover:text-white transition-colors">Terms</Link>
          </nav>
        </div>
      </div>
      <div className="border-t border-white/8 px-6 py-4">
        <p className="max-w-7xl mx-auto text-12 text-white/35">
          © {year} {operatorName}
        </p>
      </div>
    </footer>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default async function HomePage() {
  const operator = await getOperatorRecord();
  if (!operator) return null;

  const [categoryRows, reportRows, priceRows] = await Promise.all([
    db
      .select({ category: products.category })
      .from(products)
      .where(and(eq(products.operatorId, operator.id), ne(products.category, "Fireworks")))
      .groupBy(products.category)
      .orderBy(products.category),

    db
      .select({
        id: fishingReports.id,
        catchSummary: fishingReports.catchSummary,
        fishCounts: fishingReports.fishCounts,
        photoUrls: fishingReports.photoUrls,
        departureDate: trips.departureDate,
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
      .limit(3),

    db
      .select({ priceCents: productPrices.priceCents })
      .from(productPrices)
      .innerJoin(products, eq(productPrices.productId, products.id))
      .where(and(eq(products.operatorId, operator.id), eq(productPrices.active, true))),
  ]);

  const allPriceCents = priceRows.map((r) => r.priceCents);
  const fromPrice = allPriceCents.length > 0 ? Math.min(...allPriceCents) : null;
  const categories = categoryRows.map((r) => r.category);

  return (
    <>
      <HeroSection
        operatorName={operator.name}
        fromPrice={fromPrice}
        dockAddress={operator.dockAddress}
      />
      <TripCategoriesSection categories={categories} />
      <WhyUsSection />
      {reportRows.length > 0 && <ReportsTeaserSection reports={reportRows} />}
      <Footer
        operatorName={operator.name}
        dockAddress={operator.dockAddress}
        phone={operator.phone}
      />
    </>
  );
}
