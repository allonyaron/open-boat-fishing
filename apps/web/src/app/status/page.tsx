import { db } from "@/lib/db";
import { operators, vessels, products, productPrices, domains } from "@openboat/db";
import { eq, count } from "drizzle-orm";

export const dynamic = "force-dynamic";

export default async function StatusPage() {
  const [operator] = await db.select().from(operators).limit(1);

  if (!operator) {
    return (
      <main className="min-h-screen bg-gray-950 flex items-center justify-center p-8">
        <div className="text-center">
          <div className="text-4xl mb-4">⚠️</div>
          <h1 className="text-xl font-bold text-red-400 mb-2">No operator seeded</h1>
          <code className="text-gray-400 text-sm">pnpm --filter @openboat/db seed</code>
        </div>
      </main>
    );
  }

  const fleetRows = await db
    .select({
      id: vessels.id,
      name: vessels.name,
      color: vessels.color,
      capacity: vessels.capacity,
      productCount: count(products.id),
    })
    .from(vessels)
    .leftJoin(products, eq(products.vesselId, vessels.id))
    .where(eq(vessels.operatorId, operator.id))
    .groupBy(vessels.id)
    .orderBy(vessels.name);

  const [{ value: totalProducts }] = await db
    .select({ value: count() })
    .from(products)
    .where(eq(products.operatorId, operator.id));

  const [{ value: totalPrices }] = await db
    .select({ value: count() })
    .from(productPrices)
    .innerJoin(products, eq(products.id, productPrices.productId))
    .where(eq(products.operatorId, operator.id));

  const domainRows = await db
    .select()
    .from(domains)
    .where(eq(domains.operatorId, operator.id));

  const checks = [
    { label: "Next.js + Railway Postgres", done: true, detail: "App running, DB connected" },
    { label: "Schema + migration", done: true, detail: "13 tables, 5 enums applied" },
    { label: "Seed data", done: true, detail: "4 vessels · 61 products · 98 prices" },
    { label: "GET /api/trips", done: true, detail: "Calendar data endpoint live" },
    { label: "Calendar UI + side panel", done: true, detail: "Month view, trip selection, cart" },
    { label: "Stripe Connect + checkout", done: false, detail: "Payment intent, $2.50 platform fee" },
    { label: "Booking confirmation", done: false, detail: "Email via Resend + SMS via Twilio" },
    { label: "Boarding pass page", done: false, detail: "/boarding/[ticketId] — printable, QR" },
    { label: "Apple / Google Wallet", done: false, detail: "Passes delivered post-payment" },
    { label: "Admin dashboard", done: false, detail: "Schedule CRUD, materialize, refunds" },
    { label: "Expo mate app", done: false, detail: "QR scanner, offline manifest, check-in" },
  ];

  const planned = [
    {
      icon: "⏳",
      label: "Automated waitlist",
      detail:
        "Trip fills → customer joins waitlist. On cancellation, first in line gets a 2-hr reservation link. If unclaimed, next person is notified. Zero manual work — all triggered by Stripe refund webhook.",
    },
    {
      icon: "👤",
      label: "Repeat customer flow",
      detail:
        "Account created silently from checkout info. Return visit: enter email → magic link → info pre-fills. Web: magic link login. Mobile: full history + saved boarding passes. No signup form ever.",
    },
    {
      icon: "📱",
      label: "Apple / Google Wallet passes",
      detail:
        "Post-payment: tap 'Add to Apple Wallet'. QR lives on lock screen, phone notifies morning of trip. Mate scans from lock screen — customer needs nothing else.",
    },
    {
      icon: "🛒",
      label: "Persistent cross-trip cart",
      detail:
        "Cart survives month navigation — book a July trip and August trip in one checkout. Needs a top-level cart context lifted above the calendar component.",
    },
  ];

  const doneCount = checks.filter((c) => c.done).length;
  const pct = Math.round((doneCount / checks.length) * 100);

  return (
    <main className="min-h-screen bg-gray-950 text-white">
      {/* Hero header */}
      <div className="border-b border-white/10 px-8 py-10">
        <div className="max-w-4xl mx-auto">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-widest text-blue-400 mb-2">
                Build Status
              </p>
              <h1 className="text-4xl font-bold tracking-tight">{operator.name}</h1>
              <div className="flex gap-2 mt-3 flex-wrap">
                {domainRows.map((d) => (
                  <span
                    key={d.domain}
                    className="text-xs bg-white/10 rounded-full px-3 py-1 text-gray-300"
                  >
                    {d.domain}
                    {d.primary && (
                      <span className="ml-1 text-blue-400">primary</span>
                    )}
                  </span>
                ))}
              </div>
            </div>
            <div className="text-right flex-shrink-0">
              <div className="text-5xl font-bold tabular-nums">{pct}%</div>
              <div className="text-gray-400 text-sm mt-1">complete</div>
            </div>
          </div>

          {/* Progress bar */}
          <div className="mt-6 h-2 bg-white/10 rounded-full overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-blue-500 to-emerald-400 rounded-full transition-all"
              style={{ width: `${pct}%` }}
            />
          </div>
          <div className="flex justify-between text-xs text-gray-500 mt-1">
            <span>{doneCount} of {checks.length} milestones done</span>
            <span>{checks.length - doneCount} remaining</span>
          </div>
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-8 py-10 space-y-12">

        {/* Stats row */}
        <div className="grid grid-cols-3 gap-4">
          {[
            { label: "Vessels", value: fleetRows.length },
            { label: "Products", value: totalProducts },
            { label: "Price rows", value: totalPrices },
          ].map((s) => (
            <div key={s.label} className="bg-white/5 border border-white/10 rounded-2xl p-5 text-center">
              <div className="text-3xl font-bold">{s.value}</div>
              <div className="text-gray-400 text-sm mt-1">{s.label}</div>
            </div>
          ))}
        </div>

        {/* Build milestones */}
        <section>
          <h2 className="text-xs font-semibold uppercase tracking-widest text-gray-400 mb-4">
            Milestones
          </h2>
          <div className="space-y-2">
            {checks.map((c, i) => (
              <div
                key={c.label}
                className={`flex items-center gap-4 rounded-xl px-4 py-3 border transition-colors ${
                  c.done
                    ? "bg-emerald-950/40 border-emerald-800/40"
                    : "bg-white/[0.03] border-white/10"
                }`}
              >
                <div
                  className={`w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 text-xs font-bold ${
                    c.done
                      ? "bg-emerald-500 text-white"
                      : "bg-white/10 text-gray-500"
                  }`}
                >
                  {c.done ? "✓" : i + 1}
                </div>
                <div className="flex-1 min-w-0">
                  <div className={`text-sm font-medium ${c.done ? "text-white" : "text-gray-400"}`}>
                    {c.label}
                  </div>
                  <div className="text-xs text-gray-500 mt-0.5">{c.detail}</div>
                </div>
                {c.done && (
                  <span className="text-xs text-emerald-500 font-medium flex-shrink-0">Done</span>
                )}
              </div>
            ))}
          </div>
        </section>

        {/* Fleet */}
        <section>
          <h2 className="text-xs font-semibold uppercase tracking-widest text-gray-400 mb-4">
            Fleet
          </h2>
          <div className="grid gap-3 sm:grid-cols-2">
            {fleetRows.map((v) => (
              <div
                key={v.id}
                className="bg-white/[0.03] border border-white/10 rounded-2xl p-5 flex items-center gap-4"
              >
                <div
                  className="w-10 h-10 rounded-xl flex-shrink-0"
                  style={{ backgroundColor: v.color }}
                />
                <div>
                  <div className="font-semibold">{v.name}</div>
                  <div className="text-sm text-gray-400 mt-0.5">
                    {v.productCount} products · {v.capacity} capacity
                  </div>
                  <div className="text-xs font-mono text-gray-600 mt-0.5">{v.color}</div>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* Planned features */}
        <section>
          <h2 className="text-xs font-semibold uppercase tracking-widest text-gray-400 mb-1">
            Planned Features
          </h2>
          <p className="text-gray-600 text-sm mb-4">Decided — not yet built</p>
          <div className="grid gap-3 sm:grid-cols-2">
            {planned.map((f) => (
              <div
                key={f.label}
                className="bg-blue-950/30 border border-blue-800/30 rounded-2xl p-5"
              >
                <div className="text-2xl mb-2">{f.icon}</div>
                <div className="font-semibold text-sm text-blue-300 mb-1">{f.label}</div>
                <div className="text-xs text-gray-400 leading-relaxed">{f.detail}</div>
              </div>
            ))}
          </div>
        </section>

        {/* Operator config */}
        <section>
          <h2 className="text-xs font-semibold uppercase tracking-widest text-gray-400 mb-4">
            Operator Config
          </h2>
          <div className="bg-white/[0.03] border border-white/10 rounded-2xl overflow-hidden">
            {[
              { label: "Name", value: operator.name },
              { label: "Slug", value: operator.slug },
              { label: "Email from", value: operator.emailFrom },
              { label: "Stripe", value: operator.stripeOnboardingComplete ? "Connected" : "Not connected" },
            ].map((row, i, arr) => (
              <div
                key={row.label}
                className={`flex items-center px-5 py-3 text-sm ${
                  i < arr.length - 1 ? "border-b border-white/5" : ""
                }`}
              >
                <span className="text-gray-500 w-32 flex-shrink-0">{row.label}</span>
                <span className={`font-medium ${
                  row.label === "Stripe" && !operator.stripeOnboardingComplete
                    ? "text-amber-400"
                    : "text-white"
                }`}>
                  {row.value}
                </span>
              </div>
            ))}
          </div>
        </section>

      </div>
    </main>
  );
}
