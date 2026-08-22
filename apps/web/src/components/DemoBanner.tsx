import { env } from "@/lib/env";

export function DemoBanner() {
  if (env.DEMO_MODE !== "true") return null;

  return (
    <div
      className="w-full text-xs md:text-sm"
      style={{ background: "#FDE68A", color: "#78350F", borderBottom: "1px solid #F59E0B" }}
      role="status"
    >
      <div className="max-w-7xl mx-auto px-4 md:px-6 py-2 flex flex-col md:flex-row md:items-center gap-1 md:gap-4">
        <span className="font-bold tracking-wide uppercase text-[11px] md:text-xs">
          Live demo
        </span>
        <span className="flex-1">
          No real payments — test with card <code className="font-mono">4242 4242 4242 4242</code>.
          Bookings reset nightly.
        </span>
        <a
          href="/admin/login"
          className="underline underline-offset-2 hover:no-underline whitespace-nowrap"
        >
          Admin login →
        </a>
      </div>
    </div>
  );
}
