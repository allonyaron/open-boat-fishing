/**
 * Status lights: a square, a colour and a word, every time — status is never
 * colour alone. Filled = happening or done, hollow = waiting, dashed = one-off.
 */

export type LampTone = "go" | "caution" | "alert" | "ink" | "ink-2" | "ink-3" | "key" | "control";
export type LampShape = "filled" | "hollow" | "dashed";

const LAMP_FILL: Record<LampTone, string> = {
  go: "bg-ob-go border-ob-go",
  caution: "bg-ob-caution border-ob-caution",
  alert: "bg-ob-alert border-ob-alert",
  ink: "bg-ob-ink border-ob-ink",
  "ink-2": "bg-ob-ink-2 border-ob-ink-2",
  "ink-3": "bg-ob-ink-3 border-ob-ink-3",
  key: "bg-ob-key border-ob-key",
  control: "bg-ob-control border-ob-control",
};

const LAMP_EDGE: Record<LampTone, string> = {
  go: "border-ob-go",
  caution: "border-ob-caution",
  alert: "border-ob-alert",
  ink: "border-ob-ink",
  "ink-2": "border-ob-ink-2",
  "ink-3": "border-ob-ink-3",
  key: "border-ob-key",
  control: "border-ob-control",
};

/** The bare square. Decorative on its own — always pair it with a word. */
export function Lamp({
  tone,
  shape = "filled",
  size = 12,
  pulse = false,
  className = "",
}: {
  tone: LampTone;
  shape?: LampShape;
  size?: 8 | 10 | 12;
  pulse?: boolean;
  className?: string;
}) {
  const sizeCls = size === 8 ? "w-2 h-2" : size === 10 ? "w-2.5 h-2.5" : "w-3 h-3";
  const look =
    shape === "filled"
      ? LAMP_FILL[tone]
      : `bg-transparent ${LAMP_EDGE[tone]} ${shape === "dashed" ? "border-dashed" : "border-solid"}`;
  return (
    <span
      aria-hidden="true"
      className={`inline-block flex-none rounded-lamp border-2 ${sizeCls} ${look} ${pulse ? "animate-ob-pulse" : ""} ${className}`}
    />
  );
}

export type LightKind =
  // trips
  | "on-sale"
  | "filling-up"
  | "sold-out"
  | "added"
  | "boarding"
  | "departed"
  | "cancelled"
  // reports
  | "report-owed"
  // tickets
  | "not-here"
  | "aboard"
  | "refunded"
  // weekly schedule patterns
  | "running"
  | "paused"
  // money ledger
  | "coming-up"
  | "just-sailed"
  | "sailed"
  | "paid-out";

type LightSpec = { label: string; tone: LampTone; shape: LampShape; word: string; pulse?: boolean };

const LIGHTS: Record<LightKind, LightSpec> = {
  "on-sale": { label: "On sale", tone: "ink-2", shape: "hollow", word: "text-ob-ink" },
  "filling-up": { label: "Filling up", tone: "caution", shape: "filled", word: "text-ob-caution-ink" },
  "sold-out": { label: "Sold out", tone: "go", shape: "filled", word: "text-ob-go-ink" },
  added: { label: "Added", tone: "ink", shape: "dashed", word: "text-ob-ink" },
  boarding: { label: "Boarding now", tone: "go", shape: "filled", word: "text-ob-go-ink", pulse: true },
  departed: { label: "Departed", tone: "ink-3", shape: "filled", word: "text-ob-ink-2" },
  cancelled: { label: "Cancelled", tone: "alert", shape: "filled", word: "text-ob-alert-ink" },
  "report-owed": { label: "Report owed", tone: "caution", shape: "filled", word: "text-ob-caution-ink" },
  "not-here": { label: "Not here yet", tone: "ink-2", shape: "hollow", word: "text-ob-ink" },
  aboard: { label: "Aboard", tone: "go", shape: "filled", word: "text-ob-go-ink" },
  refunded: { label: "Refunded", tone: "alert", shape: "filled", word: "text-ob-alert-ink" },
  running: { label: "Running", tone: "go", shape: "filled", word: "text-ob-go-ink" },
  paused: { label: "Paused", tone: "ink-2", shape: "hollow", word: "text-ob-ink" },
  "coming-up": { label: "Coming up", tone: "ink-2", shape: "hollow", word: "text-ob-ink" },
  "just-sailed": { label: "Just sailed", tone: "caution", shape: "filled", word: "text-ob-caution-ink" },
  sailed: { label: "Sailed", tone: "go", shape: "filled", word: "text-ob-go-ink" },
  "paid-out": { label: "Paid out", tone: "go", shape: "filled", word: "text-ob-go-ink" },
};

export function lightLabel(kind: LightKind): string {
  return LIGHTS[kind].label;
}

/** A status light plus its word. `dense` = the 10px lamp used in Desk tables. */
export function StatusLight({
  kind,
  label,
  dense = false,
  className = "",
}: {
  kind: LightKind;
  /** Override the word (e.g. "Aboard 6:42 AM"); keep it starting with the status. */
  label?: string;
  dense?: boolean;
  className?: string;
}) {
  const s = LIGHTS[kind];
  return (
    <span className={`inline-flex items-center gap-2.5 whitespace-nowrap ${className}`}>
      <Lamp tone={s.tone} shape={s.shape} size={dense ? 10 : 12} pulse={s.pulse} />
      <span className={`text-body-sm font-bold ${s.word}`}>{label ?? s.label}</span>
    </span>
  );
}

// ── Derivations ─────────────────────────────────────────────────────────────

export type TripLightKind = Extract<LightKind, "on-sale" | "filling-up" | "sold-out" | "added" | "cancelled">;

/**
 * Derives the light for a trip row. Cancelled always wins; "Added" (a one-off
 * departure outside any weekly pattern — scheduleId is null) takes priority
 * over the sold-percentage tiers so a fresh one-off doesn't get lost among the
 * pattern's regular "On sale" rows before anyone's booked it.
 */
export function tripLightKind(trip: {
  status: string;
  scheduleId: string | null;
  capacity: number;
  ticketsSold: number;
}): TripLightKind {
  if (trip.status === "cancelled") return "cancelled";
  if (trip.ticketsSold >= trip.capacity) return "sold-out";
  if (trip.scheduleId === null) return "added";
  if (trip.capacity > 0 && trip.ticketsSold / trip.capacity >= 0.7) return "filling-up";
  return "on-sale";
}

export type TicketLightKind = Extract<LightKind, "not-here" | "aboard" | "refunded">;

export function ticketLightKind(ticket: { voided: boolean; checkedIn: boolean }): TicketLightKind {
  if (ticket.voided) return "refunded";
  if (ticket.checkedIn) return "aboard";
  return "not-here";
}
