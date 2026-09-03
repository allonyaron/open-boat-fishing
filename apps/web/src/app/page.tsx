import { BookingCalendar, type Trip } from "@/components/BookingCalendar";
import { dollars } from "@openboat/utils";
import { getOperatorRecord } from "@/lib/operator";
import Image from "next/image";

function currentMonth() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

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
      <div className="relative max-w-7xl mx-auto px-6 md:px-10 py-14 md:py-20">
        <div className="md:grid md:gap-10" style={{ gridTemplateColumns: "1.1fr 1fr" }}>
          {/* ── Left column ─────────────────────────────────────── */}
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
              <a
                href="#booking"
                className="font-manrope text-15 font-bold px-6 py-3 rounded-[9px] bg-gold text-navy transition-opacity hover:opacity-90"
              >
                Book a trip →
              </a>
              <a
                href="#booking"
                className="font-manrope text-15 font-bold px-6 py-3 rounded-[9px] text-white border border-white/35 transition-opacity hover:opacity-80"
              >
                View schedule
              </a>
            </div>
          </div>

          {/* ── Right column — framed photo (desktop only) ───────── */}
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

export default async function HomePage() {
  const month = currentMonth();
  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL ?? "http://localhost:3000";
  const [res, operator] = await Promise.all([
    fetch(`${baseUrl}/api/trips?month=${month}`, { cache: "no-store" }),
    getOperatorRecord(),
  ]);
  const trips: Trip[] = await res.json();
  const operatorName = operator?.name ?? "Fishing Charter";
  const termsUrl = operator?.termsUrl ?? null;
  const dockAddress = operator?.dockAddress ?? null;
  const allPriceCents = trips.flatMap((t) => t.product.prices.map((p) => p.priceCents));
  const fromPrice = allPriceCents.length > 0 ? Math.min(...allPriceCents) : null;

  return (
    <>
      <HeroSection operatorName={operatorName} fromPrice={fromPrice} dockAddress={dockAddress} />
      <div id="booking">
        <BookingCalendar
          initialTrips={trips}
          initialMonth={month}
          operatorName={operatorName}
          termsUrl={termsUrl}
        />
      </div>
    </>
  );
}
