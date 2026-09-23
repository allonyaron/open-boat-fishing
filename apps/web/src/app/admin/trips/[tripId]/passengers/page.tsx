"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter, useParams } from "next/navigation";
import { dollars } from "@openboat/utils";
import { fmtTimeET } from "@/lib/format";
import {
  Card,
  CardRow,
  Button,
  Dialog,
  TicketStatusPill,
  ticketPillStatus,
  useToast,
} from "@/components/admin/merchant";

type TicketData = {
  id: string;
  ticketType: "adult" | "child" | "senior";
  priceCents: number;
  voided: boolean;
  passengerName: string | null;
  checkedIn: boolean;
  checkedInAt: string | null;
};

type BookingData = {
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

type TripDetail = {
  id: string;
  departureDate: string;
  startTime: string;
  endTime: string;
  status: string;
  vessel: { name: string; color: string };
  product: { displayName: string };
};

const TICKET_LABEL: Record<TicketData["ticketType"], string> = { adult: "Adult", child: "Child", senior: "Senior" };

function fmtLongDateET(dateStr: string): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  });
}

export default function PassengerListPage() {
  const router = useRouter();
  const params = useParams<{ tripId: string }>();
  const { showToast } = useToast();
  const [trip, setTrip] = useState<TripDetail | null>(null);
  const [bookings, setBookings] = useState<BookingData[] | null>(null);
  const [error, setError] = useState(false);
  const [busyTicket, setBusyTicket] = useState<string | null>(null);
  const [refundTarget, setRefundTarget] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(false);
    try {
      const res = await fetch(`/api/admin/trips/${params.tripId}`);
      if (!res.ok) throw new Error("failed");
      const body = await res.json();
      setTrip(body.trip);
      setBookings(body.bookings);
    } catch {
      setError(true);
    }
  }, [params.tripId]);

  useEffect(() => {
    load();
  }, [load]);

  async function toggleCheckIn(ticketId: string, checkedIn: boolean) {
    setBusyTicket(ticketId);
    try {
      const res = await fetch(`/api/admin/trips/${params.tripId}/checkins`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ticketId, checkedIn }),
      });
      const body = await res.json();
      if (!res.ok) {
        showToast(body.error ?? "Couldn't update check-in.");
        return;
      }
      await load();
    } finally {
      setBusyTicket(null);
    }
  }

  async function submitRefund(ticketId: string) {
    setBusyTicket(ticketId);
    try {
      const res = await fetch(`/api/admin/tickets/${ticketId}/refund`, { method: "POST" });
      const body = await res.json();
      if (!res.ok) {
        showToast(body.error ?? "Couldn't refund this ticket.");
        return;
      }
      showToast(`Refunded ${dollars(body.refundedCents)}. The seat is back on sale.`);
      setRefundTarget(null);
      await load();
    } finally {
      setBusyTicket(null);
    }
  }

  if (error) {
    return (
      <div className="rounded-xl border border-merchant-red-tint bg-[#fff8f7] p-5">
        <div className="text-14 font-semibold text-merchant-red">Can&rsquo;t reach the booking system</div>
        <p className="mt-1 text-13 text-merchant-muted">
          This trip&rsquo;s passenger list just can&rsquo;t load right now.
        </p>
        <Button variant="secondary" className="mt-3" onClick={load}>
          Try again
        </Button>
      </div>
    );
  }

  const allTickets = bookings?.flatMap((b) => b.tickets) ?? [];
  const liveTickets = allTickets.filter((t) => !t.voided);
  const checkedInCount = liveTickets.filter((t) => t.checkedIn).length;
  const paidCents = liveTickets.reduce((s, t) => s + t.priceCents, 0);
  const refundedCount = allTickets.filter((t) => t.voided).length;

  return (
    <div className="flex flex-col gap-4">
      <div className="print:hidden">
        <button
          onClick={() => router.push("/admin")}
          className="text-13 font-semibold text-merchant-blue hover:underline"
        >
          ← Back to today
        </button>
      </div>

      {trip && (
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-20 font-bold text-merchant-ink" style={{ letterSpacing: "-0.01em" }}>
              {trip.product.displayName} · {trip.vessel.name}
            </h1>
            <div className="text-13 text-merchant-muted">
              {fmtLongDateET(trip.departureDate)} · leaves {fmtTimeET(trip.startTime)}, back {fmtTimeET(trip.endTime)}
            </div>
          </div>
          <Button variant="secondary" className="print:hidden" onClick={() => window.print()}>
            Print the list
          </Button>
        </div>
      )}

      <div className="grid gap-3 print:hidden" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))" }}>
        <Card>
          <div className="p-3.5">
            <div className="text-13 text-merchant-muted">Checked in</div>
            <div className="text-22 font-bold text-merchant-ink tabular-nums mt-0.5">
              {checkedInCount} of {liveTickets.length} aboard
            </div>
          </div>
        </Card>
        <Card>
          <div className="p-3.5">
            <div className="text-13 text-merchant-muted">Paid for this trip</div>
            <div className="text-22 font-bold text-merchant-ink tabular-nums mt-0.5">{dollars(paidCents)}</div>
          </div>
        </Card>
        <Card>
          <div className="p-3.5">
            <div className="text-13 text-merchant-muted">Tickets given back</div>
            <div className="text-22 font-bold text-merchant-ink tabular-nums mt-0.5">{refundedCount}</div>
          </div>
        </Card>
      </div>

      <Card>
        {!bookings ? (
          <CardRow className="text-13 text-merchant-muted">Loading…</CardRow>
        ) : bookings.length === 0 ? (
          <CardRow className="text-center py-8">
            <div className="text-14 font-semibold text-merchant-ink">Nobody has booked this trip yet.</div>
            <div className="text-13 text-merchant-muted mt-1">Seats are open on your website right now.</div>
          </CardRow>
        ) : (
          bookings.map((booking) => (
            <CardRow key={booking.id}>
              <div className="flex flex-wrap items-baseline justify-between gap-2 mb-2">
                <div className="flex items-baseline gap-2">
                  <span className="text-14 font-bold text-merchant-ink">{booking.customerName ?? booking.customerEmail}</span>
                  <span className="text-12 text-merchant-faint tabular-nums">{booking.confirmationCode}</span>
                </div>
                <div className="text-13 text-merchant-muted">
                  {[booking.customerPhone, booking.customerEmail].filter(Boolean).join(" · ")}
                </div>
              </div>
              {booking.notes && (
                <div className="inline-block rounded-lg bg-merchant-amber-soft text-merchant-amber-deep text-13 px-2.5 py-1.5 mb-2">
                  {booking.notes}
                </div>
              )}
              <div className="flex flex-col gap-2">
                {booking.tickets.map((ticket) => {
                  const pill = ticketPillStatus(ticket);
                  const label = ticket.passengerName
                    ? `${ticket.passengerName} · ${TICKET_LABEL[ticket.ticketType]}`
                    : `${TICKET_LABEL[ticket.ticketType]} ticket`;
                  const busy = busyTicket === ticket.id;
                  return (
                    <div
                      key={ticket.id}
                      className={`flex flex-wrap items-center justify-between gap-2 rounded-[10px] bg-merchant-fill px-3 py-2.5 ${
                        ticket.voided ? "opacity-70" : ""
                      }`}
                    >
                      <div className={`text-13 ${ticket.voided ? "line-through text-merchant-faint" : "text-merchant-ink"}`}>
                        {label}{" "}
                        <span className={ticket.voided ? "line-through" : "text-merchant-faint"}>
                          {dollars(ticket.priceCents)}
                        </span>
                      </div>
                      <div className="flex items-center gap-2 print:hidden">
                        <TicketStatusPill status={pill} />
                        <Button
                          variant={ticket.checkedIn ? "secondary" : "primary"}
                          disabled={busy}
                          onClick={() =>
                            ticket.voided
                              ? showToast("This ticket was refunded — nothing to check in.")
                              : toggleCheckIn(ticket.id, !ticket.checkedIn)
                          }
                        >
                          {ticket.checkedIn ? "Undo" : "Aboard"}
                        </Button>
                        <Button
                          variant="secondary"
                          disabled={busy}
                          onClick={() =>
                            ticket.voided
                              ? showToast("This ticket was already refunded.")
                              : setRefundTarget(ticket.id)
                          }
                        >
                          Refund
                        </Button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </CardRow>
          ))
        )}
      </Card>

      <Dialog
        open={!!refundTarget}
        onClose={() => setRefundTarget(null)}
        title="Refund one ticket"
        footer={
          <>
            <Button variant="secondary" onClick={() => setRefundTarget(null)} disabled={!!busyTicket}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={!!busyTicket}
              onClick={() => refundTarget && submitRefund(refundTarget)}
            >
              Refund this ticket
            </Button>
          </>
        }
      >
        <p className="text-13 text-merchant-muted">
          The amount goes back to the original card in a few days. The seat returns to sale. The rest of the booking
          is untouched. This cannot be undone.
        </p>
      </Dialog>
    </div>
  );
}
