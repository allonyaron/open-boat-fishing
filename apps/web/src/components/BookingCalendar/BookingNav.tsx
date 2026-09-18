export function BookingNav({
  operatorName,
  dockAddress,
  phone,
  step,
}: {
  operatorName: string;
  dockAddress: string | null;
  phone: string | null;
  step: 1 | 2 | 3;
}) {
  const steps: [number, string][] = [
    [1, "PICK A TRIP"],
    [2, "PAY"],
    [3, "CONFIRMED"],
  ];
  return (
    <>
      {/* Utility strip */}
      {(dockAddress || phone) && (
        <div className="bg-hull px-6 flex flex-wrap gap-3 justify-between font-plex-mono text-[12px] tracking-[.1em] text-ink-dark-3" style={{ padding: "9px 24px" }}>
          <span>{dockAddress ?? ""}</span>
          {phone && <span>QUESTIONS? {phone}</span>}
        </div>
      )}
      {/* Brand + step nav */}
      <div className="hull bg-hull px-6 flex flex-wrap gap-4 items-center justify-between" style={{ borderBottom: "3px solid #d1541f", padding: "14px 24px" }}>
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
                className={`px-[14px] py-[10px] font-plex-mono text-[13px] font-semibold tracking-[.1em] ${active ? "bg-orange text-white" : "text-ink-dark-3"}`}
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
