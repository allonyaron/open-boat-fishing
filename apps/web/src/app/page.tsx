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
    <section style={{ background: "#14233d" }} className="relative overflow-hidden">
      {/* Two-column split — collapses to single column on mobile */}
      <div
        className="relative max-w-7xl mx-auto px-6 md:px-10 py-14 md:py-20 grid md:gap-10"
        style={{ gridTemplateColumns: "1fr" }}
      >
        <div className="md:grid md:gap-10" style={{ gridTemplateColumns: "1.1fr 1fr" }}>
          {/* ── Left column ─────────────────────────────────────── */}
          <div className="flex flex-col justify-center">
            {/* Eyebrow */}
            <p
              className="text-13 font-bold uppercase mb-4"
              style={{ color: "#c99a3f", letterSpacing: "0.14em" }}
            >
              {eyebrow}
            </p>

            {/* Headline */}
            <h1
              className="font-manrope text-36 md:text-48 font-extrabold text-white mb-4"
              style={{ lineHeight: 1.08 }}
            >
              {operatorName}
            </h1>

            {/* Subhead */}
            <p className="text-16 mb-6" style={{ color: "#b9c0d1" }}>
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
                  className="text-13 font-medium px-3 py-1 rounded-full"
                  style={{
                    background: "rgba(255,255,255,0.08)",
                    color: "#e7d9b8",
                    border: "1px solid rgba(255,255,255,0.12)",
                    borderRadius: "20px",
                  }}
                >
                  {label}
                </span>
              ))}
            </div>

            {/* CTAs */}
            <div className="flex flex-wrap gap-3">
              <a
                href="#booking"
                className="font-manrope text-15 font-bold px-6 py-3 transition-opacity hover:opacity-90"
                style={{
                  background: "#c99a3f",
                  color: "#182337",
                  borderRadius: "9px",
                }}
              >
                Book a trip →
              </a>
              <a
                href="#booking"
                className="font-manrope text-15 font-bold px-6 py-3 text-white transition-opacity hover:opacity-80"
                style={{
                  border: "1.5px solid rgba(255,255,255,0.35)",
                  borderRadius: "9px",
                }}
              >
                View schedule
              </a>
            </div>
          </div>

          {/* ── Right column — framed photo (desktop only) ───────── */}
          <div className="hidden md:flex items-center justify-center relative">
            {/* Rotated gold frame */}
            <div
              className="absolute inset-4"
              style={{
                border: "1px solid rgba(201,154,63,0.5)",
                borderRadius: "20px",
                transform: "rotate(1.5deg)",
              }}
            />
            {/* Hero photo */}
            <div className="relative w-full rounded-2xl overflow-hidden" style={{ aspectRatio: "4/3" }}>
              <Image
                src="/hero-boat.png"
                alt="Fishing boat with anglers at sea"
                fill
                className="object-cover"
                priority
              />
            </div>

            {/* Floating stat card */}
            <div
              className="absolute -bottom-4 -left-4 bg-white px-4 py-3 rounded-xl"
              style={{ boxShadow: "0 8px 24px rgba(20,35,60,0.18)" }}
            >
              <div className="font-manrope text-20 font-extrabold" style={{ color: "#14233d" }}>
                500+
              </div>
              <div className="text-12 font-medium" style={{ color: "#9a9fac" }}>
                trips run
              </div>
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
