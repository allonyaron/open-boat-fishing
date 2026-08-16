import { BookingCalendar, type Trip } from "@/components/BookingCalendar";
import { db } from "@/lib/db";
import { operators } from "@openboat/db";

function currentMonth() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

function dollars(cents: number) {
  const n = cents / 100;
  return `$${Number.isInteger(n) ? n : n.toFixed(2)}`;
}

function AnchorIcon() {
  return (
    <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#E8C547" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="5" r="3"/>
      <line x1="12" y1="22" x2="12" y2="8"/>
      <path d="M5 12H2a10 10 0 0 0 20 0h-3"/>
    </svg>
  );
}

function HeroSection({ operatorName, fromPrice }: { operatorName: string; fromPrice: number | null }) {
  return (
    <section className="relative overflow-hidden" style={{ background: "linear-gradient(150deg, #162D45 0%, #0D1B2A 100%)" }}>
      <div className="absolute inset-0 opacity-[0.04]"
        style={{ backgroundImage: "repeating-linear-gradient(45deg, #fff 0px, #fff 1px, transparent 1px, transparent 12px)" }} />
      <div className="relative px-5 pt-10 pb-20 md:pt-14 md:pb-24 text-center max-w-xl mx-auto">
        <div className="inline-flex items-center justify-center w-14 h-14 rounded-[16px] mb-5"
          style={{ background: "rgba(201,146,42,0.18)", border: "1px solid rgba(201,146,42,0.3)" }}>
          <AnchorIcon />
        </div>
        <h1 className="font-grotesk text-[30px] md:text-[40px] font-bold text-white mb-3 leading-tight tracking-tight">
          {operatorName}
        </h1>
        <p className="text-white/60 text-[15px] md:text-[16px] mb-5 leading-relaxed">
          Party fishing trips · Book your spot online
        </p>
        {fromPrice !== null && (
          <span className="inline-flex items-center gap-1.5 rounded-pill px-4 py-1.5 text-[13px] font-bold"
            style={{ background: "rgba(201,146,42,0.15)", border: "1px solid rgba(201,146,42,0.35)", color: "#E8C547", letterSpacing: "0.02em" }}>
            From {dollars(fromPrice)} per ticket
          </span>
        )}
      </div>
      <div className="absolute bottom-0 left-0 right-0 leading-none">
        <svg viewBox="0 0 1440 52" fill="none" xmlns="http://www.w3.org/2000/svg" className="w-full block">
          <path d="M0 52L48 46C96 40 192 28 288 25.3C384 22.7 480 29.3 576 33.3C672 37.3 768 38.7 864 36C960 33.3 1056 26.7 1152 24C1248 21.3 1344 22.7 1392 23.3L1440 24V52H0Z" fill="#F4F6F6" />
        </svg>
      </div>
    </section>
  );
}

export default async function HomePage() {
  const month = currentMonth();
  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL ?? "http://localhost:3000";
  const [res, operatorRow] = await Promise.all([
    fetch(`${baseUrl}/api/trips?month=${month}`, { cache: "no-store" }),
    db.select({ name: operators.name, termsUrl: operators.termsUrl }).from(operators).limit(1),
  ]);
  const trips: Trip[] = await res.json();
  const operatorName = operatorRow[0]?.name ?? "Fishing Charter";
  const termsUrl = operatorRow[0]?.termsUrl ?? null;
  const allPriceCents = trips.flatMap((t) => t.product.prices.map((p) => p.priceCents));
  const fromPrice = allPriceCents.length > 0 ? Math.min(...allPriceCents) : null;

  return (
    <>
      <HeroSection operatorName={operatorName} fromPrice={fromPrice} />
      <BookingCalendar initialTrips={trips} initialMonth={month} operatorName={operatorName} termsUrl={termsUrl} />
    </>
  );
}
