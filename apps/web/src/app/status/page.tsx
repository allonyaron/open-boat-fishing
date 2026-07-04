import { db } from "@/lib/db";
import { operators, vessels, products, productPrices, domains } from "@openboat/db";
import { eq, count } from "drizzle-orm";

export const dynamic = "force-dynamic";

export default async function StatusPage() {
  const [operator] = await db.select().from(operators).limit(1);

  if (!operator) {
    return (
      <main className="p-8">
        <h1 className="text-2xl font-bold text-red-600">No operator seeded</h1>
        <p className="mt-2 text-gray-600">Run <code>pnpm --filter @openboat/db seed</code></p>
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
    { label: "Next.js running", done: true },
    { label: "Railway Postgres connected", done: true },
    { label: "Migration applied", done: true },
    { label: "Seed data present", done: true },
    { label: "GET /api/trips (calendar data)", done: false },
    { label: "Calendar UI", done: false },
    { label: "Trip modal + cart", done: false },
    { label: "Stripe Connect + checkout", done: false },
    { label: "Booking confirmation + email/SMS", done: false },
    { label: "/boarding/[ticketId] printable page", done: false },
    { label: "Admin dashboard", done: false },
    { label: "Expo mate app", done: false },
  ];

  return (
    <main className="min-h-screen bg-gray-50 p-8">
      <h1 className="text-2xl font-bold mb-1">Platform Status</h1>
      <p className="text-gray-500 text-sm mb-8">Live data from Railway Postgres</p>

      {/* Progress */}
      <section className="mb-8">
        <h2 className="text-lg font-semibold mb-3">Build Progress</h2>
        <ul className="space-y-2">
          {checks.map((c) => (
            <li key={c.label} className="flex items-center gap-3">
              <span className={`text-lg ${c.done ? "text-green-500" : "text-gray-300"}`}>
                {c.done ? "✓" : "○"}
              </span>
              <span className={c.done ? "text-gray-900" : "text-gray-400"}>{c.label}</span>
            </li>
          ))}
        </ul>
      </section>

      {/* Operator */}
      <section className="mb-8">
        <h2 className="text-lg font-semibold mb-3">Operator</h2>
        <div className="bg-white rounded-lg border p-4 space-y-1 text-sm">
          <div><span className="text-gray-500 w-32 inline-block">Name</span>{operator.name}</div>
          <div><span className="text-gray-500 w-32 inline-block">Slug</span>{operator.slug}</div>
          <div><span className="text-gray-500 w-32 inline-block">Email from</span>{operator.emailFrom}</div>
          <div>
            <span className="text-gray-500 w-32 inline-block">Domains</span>
            {domainRows.map((d) => (
              <span key={d.domain} className="mr-2">
                {d.domain}{d.primary ? " (primary)" : ""}
              </span>
            ))}
          </div>
        </div>
      </section>

      {/* Fleet */}
      <section className="mb-8">
        <h2 className="text-lg font-semibold mb-3">
          Fleet — {fleetRows.length} vessels · {totalProducts} products · {totalPrices} price rows
        </h2>
        <div className="grid gap-3 sm:grid-cols-2">
          {fleetRows.map((v) => (
            <div key={v.id} className="bg-white rounded-lg border p-4 flex items-start gap-3">
              <div
                className="w-4 h-4 rounded-full mt-0.5 flex-shrink-0"
                style={{ backgroundColor: v.color }}
              />
              <div>
                <div className="font-medium">{v.name}</div>
                <div className="text-sm text-gray-500">
                  {v.productCount} products · capacity {v.capacity}
                </div>
                <div className="text-xs text-gray-400 font-mono mt-0.5">{v.color}</div>
              </div>
            </div>
          ))}
        </div>
      </section>
    </main>
  );
}
