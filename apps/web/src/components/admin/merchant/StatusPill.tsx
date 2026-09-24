export type TripPillStatus = "on-sale" | "filling-up" | "sold-out" | "added" | "cancelled";

const PILL_CLASSES: Record<TripPillStatus, string> = {
  "on-sale": "bg-merchant-hairline text-merchant-chrome-light",
  "filling-up": "bg-merchant-amber-tint text-merchant-amber-deep",
  "sold-out": "bg-merchant-green-tint text-merchant-green",
  added: "bg-merchant-blue-tint text-merchant-blue-deep",
  cancelled: "bg-merchant-red-tint text-merchant-red",
};

const PILL_LABELS: Record<TripPillStatus, string> = {
  "on-sale": "On sale",
  "filling-up": "Filling up",
  "sold-out": "Sold out",
  added: "Added",
  cancelled: "Cancelled",
};

/**
 * Derives the display status for a trip row. Cancelled always wins; "Added"
 * (a one-off departure outside any weekly pattern — scheduleId is null) takes
 * priority over the sold-percentage tiers so a fresh one-off doesn't get
 * lost among the pattern's regular "On sale" rows before anyone's booked it.
 */
export function tripPillStatus(trip: {
  status: string;
  scheduleId: string | null;
  capacity: number;
  ticketsSold: number;
}): TripPillStatus {
  if (trip.status === "cancelled") return "cancelled";
  if (trip.ticketsSold >= trip.capacity) return "sold-out";
  if (trip.scheduleId === null) return "added";
  if (trip.capacity > 0 && trip.ticketsSold / trip.capacity >= 0.7) return "filling-up";
  return "on-sale";
}

export function StatusPill({ status }: { status: TripPillStatus }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-12 font-semibold ${PILL_CLASSES[status]}`}
    >
      {PILL_LABELS[status]}
    </span>
  );
}

export type TicketPillStatus = "not-here" | "aboard" | "refunded";

const TICKET_PILL_CLASSES: Record<TicketPillStatus, string> = {
  "not-here": "bg-merchant-fill-3 text-merchant-muted",
  aboard: "bg-merchant-green-tint text-merchant-green",
  refunded: "bg-merchant-red-tint text-merchant-red",
};

const TICKET_PILL_LABELS: Record<TicketPillStatus, string> = {
  "not-here": "Not here yet",
  aboard: "Aboard",
  refunded: "Refunded",
};

export function ticketPillStatus(ticket: { voided: boolean; checkedIn: boolean }): TicketPillStatus {
  if (ticket.voided) return "refunded";
  if (ticket.checkedIn) return "aboard";
  return "not-here";
}

export function TicketStatusPill({ status }: { status: TicketPillStatus }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-12 font-semibold ${TICKET_PILL_CLASSES[status]}`}
    >
      {TICKET_PILL_LABELS[status]}
    </span>
  );
}
