// Mobile header config per step
const STEP_MOBILE: Record<1 | 2 | 3, { leftHref: string; leftLabel: string; rightLabel: string }> = {
  1: { leftHref: "/", leftLabel: "HOME", rightLabel: "ALL TRIPS" },
  2: { leftHref: "/book", leftLabel: "TRIPS", rightLabel: "STEP 2 OF 3 · CART" },
  3: { leftHref: "/cart", leftLabel: "CART", rightLabel: "STEP 3 OF 3 · PAY" },
};

export function BookingNav({
  operatorName,
  dockAddress,
  phone,
  step,
  rightLabelOverride,
  rightLabelColor,
}: {
  operatorName: string;
  dockAddress: string | null;
  phone: string | null;
  step: 1 | 2 | 3;
  rightLabelOverride?: string;
  rightLabelColor?: string;
}) {
  const steps: [number, string][] = [
    [1, "PICK A TRIP"],
    [2, "PAY"],
    [3, "CONFIRMED"],
  ];
  const mobile = STEP_MOBILE[step];
  const rightLabel = rightLabelOverride ?? mobile.rightLabel;
  const rightColor = rightLabelColor ?? "#c9d6dd";
  return (
    <>
      {/* Mobile header */}
      <div
        className="lg:hidden sticky top-0 z-50 flex items-center justify-between bg-hull"
        style={{ height: 54, padding: "0 16px", borderBottom: "3px solid #c94510" }}
      >
        <a
          href={mobile.leftHref}
          className="font-plex-mono font-semibold tracking-[.1em] uppercase"
          style={{ fontSize: 12, color: "#dfe8ec", textDecoration: "none" }}
        >
          ← {mobile.leftLabel}
        </a>
        <span
          className="font-plex-mono font-semibold"
          style={{ fontSize: 11, letterSpacing: ".14em", color: rightColor }}
        >
          {rightLabel}
        </span>
      </div>

      {/* Desktop header */}
      {(dockAddress || phone) && (
        <div
          className="hidden lg:flex bg-hull flex-wrap gap-3 justify-between font-plex-mono text-[12px] tracking-[.1em] text-ink-dark-3"
          style={{ padding: "9px 24px" }}
        >
          <span>{dockAddress ?? ""}</span>
          {phone && <span>QUESTIONS? {phone}</span>}
        </div>
      )}
      <div
        className="hidden lg:flex hull bg-hull flex-wrap gap-4 items-center justify-between"
        style={{ borderBottom: "3px solid #c94510", padding: "14px 24px" }}
      >
        <a
          href="/"
          className="text-[22px] font-bold tracking-[.05em] text-white uppercase font-archivo"
          style={{ textDecoration: "none" }}
        >
          {operatorName}
        </a>
        <ol className="flex gap-[4px] list-none m-0 p-0" aria-label="Booking steps">
          {steps.map(([n, label]) => {
            const active = n === step;
            return (
              <li
                key={n}
                aria-current={active ? "step" : undefined}
                className={`px-[14px] py-[10px] font-plex-mono text-[13px] font-semibold tracking-[.1em] ${
                  active ? "bg-orange text-white" : "text-ink-dark-3"
                }`}
              >
                {n} · {label}
              </li>
            );
          })}
        </ol>
      </div>
    </>
  );
}
