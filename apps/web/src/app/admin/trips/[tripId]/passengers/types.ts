export type TicketData = {
  id: string;
  ticketType: "adult" | "child" | "senior";
  priceCents: number;
  voided: boolean;
  passengerName: string | null;
  checkedIn: boolean;
  checkedInAt: string | null;
};

export type BookingData = {
  id: string;
  confirmationCode: string;
  customerName: string | null;
  customerEmail: string;
  customerPhone: string | null;
  notes: string | null;
  status: string;
  totalCents: number;
  tickets: TicketData[];
};

export type TripDetail = {
  id: string;
  departureDate: string;
  startTime: string;
  endTime: string;
  capacity: number;
  status: string;
  vessel: { name: string; color: string };
  product: { displayName: string };
};

export type PassengerFilter = "all" | "waiting" | "aboard";

export const TICKET_LABEL: Record<TicketData["ticketType"], string> = { adult: "Adult", child: "Child", senior: "Senior" };

export function bookingName(b: BookingData): string {
  return b.customerName ?? b.customerEmail;
}

/** The ticket's main line: the passenger's name, or "Adult ticket" when the booking didn't name them. */
export function ticketLabel(t: TicketData): string {
  return t.passengerName ?? `${TICKET_LABEL[t.ticketType]} ticket`;
}

/** The ticket type next to a named passenger; nothing when the label already says it. */
export function ticketTypeLabel(t: TicketData): string {
  return t.passengerName ? TICKET_LABEL[t.ticketType] : "";
}

/** tel: link for a phone number as stored ("(631) 555-0142" → "tel:6315550142"). */
export function telHref(phone: string): string {
  const digits = phone.replace(/[^\d+]/g, "");
  return `tel:${digits}`;
}

export function waitingTickets(b: BookingData): TicketData[] {
  return b.tickets.filter((t) => !t.voided && !t.checkedIn);
}

export function keepTicket(filter: PassengerFilter, t: TicketData): boolean {
  if (filter === "all") return true;
  if (t.voided) return false;
  return filter === "aboard" ? t.checkedIn : !t.checkedIn;
}
