import type { TicketStatus } from "@/lib/tickets/status";
import type { ChargebackState } from "@/lib/disputes/list";

export type TicketData = {
  id: string;
  ticketType: "adult" | "child" | "senior";
  priceCents: number;
  /** Only `live` can board or be refunded. */
  status: TicketStatus;
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
  /** What this booking has paid for this trip's live tickets (the server works it out). */
  paidCents: number;
  /** The booking's latest chargeback, if any (row 11). */
  chargeback: ChargebackState | null;
  tickets: TicketData[];
};

export type TripDetail = {
  id: string;
  departureDate: string;
  startTime: string;
  endTime: string;
  capacity: number;
  seatsRemaining: number;
  status: string;
  cancellationReason: string | null;
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

/** Paid for and valid: the only tickets that get Aboard and Refund buttons. */
export function isLiveTicket(t: TicketData): boolean {
  return t.status === "live";
}

/** Shown struck through: the ticket was paid for and given back, or never paid. */
export function isStruckTicket(t: TicketData): boolean {
  return t.status === "refunded" || t.status === "disputed" || t.status === "voided";
}

/** What replaces the buttons on a ticket that isn't live. */
export function notLiveNote(t: TicketData, chargeback: ChargebackState | null = null): string {
  switch (t.status) {
    case "held":
      return "Can board once paid";
    case "disputed":
      return "Can’t board while the chargeback is open";
    case "voided":
      return "Never paid";
    default:
      return chargeback === "lost" ? "Chargeback lost · seat is back on sale" : "Seat is back on sale";
  }
}

export function waitingTickets(b: BookingData): TicketData[] {
  return b.tickets.filter((t) => isLiveTicket(t) && !t.checkedIn);
}

export function keepTicket(filter: PassengerFilter, t: TicketData): boolean {
  if (filter === "all") return true;
  if (!isLiveTicket(t)) return false;
  return filter === "aboard" ? t.checkedIn : !t.checkedIn;
}
