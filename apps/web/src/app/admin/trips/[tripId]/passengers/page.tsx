"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { dollars } from "@openboat/utils";
import { fmtLongDateET, fmtTimeET } from "@/lib/format";
import { todayET } from "@/lib/date-et";
import {
  Button,
  Dialog,
  CautionBox,
  SummaryBox,
  Segmented,
  StatusLight,
  tripLightKind,
  useDensity,
  useNow,
  useToast,
  fmtMoney,
  ReadoutCell,
  ReadoutValue,
  ErrorState,
  EmptyState,
  LoadingState,
  Lamp,
  ChevronLeftIcon,
  PrintIcon,
  UndoIcon,
} from "@/components/admin/merchant";
import { BookingListDeskPhone, BookingListDock, BookingTableDesk, type PassengerActions, type ShownBooking } from "./PassengerViews";
import { PrintSheet } from "./PrintSheet";
import {
  bookingName,
  keepTicket,
  ticketLabel,
  TICKET_LABEL,
  waitingTickets,
  type BookingData,
  type PassengerFilter,
  type TicketData,
  type TripDetail,
} from "./types";

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export default function PassengerListPage() {
  const params = useParams<{ tripId: string }>();
  const { showToast } = useToast();
  const { density } = useDensity();
  const now = useNow();
  const [trip, setTrip] = useState<TripDetail | null>(null);
  const [bookings, setBookings] = useState<BookingData[] | null>(null);
  const [error, setError] = useState(false);
  const [busyTicket, setBusyTicket] = useState<string | null>(null);
  const [busyBooking, setBusyBooking] = useState<string | null>(null);
  const [refundTarget, setRefundTarget] = useState<{ ticket: TicketData; booking: BookingData } | null>(null);
  const [filter, setFilter] = useState<PassengerFilter>("all");
  const [operatorName, setOperatorName] = useState<string | null>(null);

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
    // Only for the printed sheet's header.
    fetch("/api/admin/settings/operator")
      .then((r) => (r.ok ? r.json() : null))
      .then((op) => setOperatorName(op?.name ?? null))
      .catch(() => {});
  }, [load]);

  async function postCheckIn(ticketId: string, checkedIn: boolean): Promise<{ ok: boolean; error?: string }> {
    const res = await fetch(`/api/admin/trips/${params.tripId}/checkins`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ticketId, checkedIn }),
    });
    const body = await res.json().catch(() => ({}));
    return res.ok ? { ok: true } : { ok: false, error: body.error };
  }

  async function toggleCheckIn(ticketId: string, checkedIn: boolean) {
    setBusyTicket(ticketId);
    try {
      const r = await postCheckIn(ticketId, checkedIn);
      if (!r.ok) {
        showToast(r.error ?? "Couldn't update check-in.", "error");
        return;
      }
      await load();
    } finally {
      setBusyTicket(null);
    }
  }

  /**
   * "All N aboard": one check-in per waiting ticket on the existing endpoint.
   * Not all-or-nothing — if some fail, say how many made it; tapping again is
   * safe because checking in a ticket that's already aboard changes nothing.
   */
  async function checkInAll(booking: BookingData) {
    const waiting = waitingTickets(booking);
    if (waiting.length === 0) return;
    setBusyBooking(booking.id);
    let done = 0;
    try {
      for (const t of waiting) {
        try {
          if ((await postCheckIn(t.id, true)).ok) done++;
        } catch {
          // Counted as not done; the toast below says so.
        }
      }
      if (done === waiting.length) showToast(`${bookingName(booking)}: ${done} aboard.`);
      else showToast(`Checked in ${done} of ${waiting.length}. Tap again for the rest.`, "error");
      await load();
    } finally {
      setBusyBooking(null);
    }
  }

  async function submitRefund(ticketId: string) {
    setBusyTicket(ticketId);
    try {
      const res = await fetch(`/api/admin/tickets/${ticketId}/refund`, { method: "POST" });
      const body = await res.json();
      if (!res.ok) {
        showToast(body.error ?? "Couldn't refund this ticket.", "error");
        return;
      }
      showToast(`Refunded ${dollars(body.refundedCents)}. The seat is back on sale.`);
      setRefundTarget(null);
      await load();
    } finally {
      setBusyTicket(null);
    }
  }

  const actions: PassengerActions = {
    onToggle: (t) => toggleCheckIn(t.id, !t.checkedIn),
    onRefund: (ticket, booking) => setRefundTarget({ ticket, booking }),
    onAllAboard: checkInAll,
    busyTicket,
    busyBooking,
  };

  const allTickets = bookings?.flatMap((b) => b.tickets) ?? [];
  const liveTickets = allTickets.filter((t) => !t.voided);
  const checkedInCount = liveTickets.filter((t) => t.checkedIn).length;
  const waitingCount = liveTickets.length - checkedInCount;
  const paidCents = liveTickets.reduce((s, t) => s + t.priceCents, 0);
  const refundedCount = allTickets.length - liveTickets.length;

  const shown: ShownBooking[] = (bookings ?? [])
    .map((booking) => ({ booking, tickets: booking.tickets.filter((t) => keepTicket(filter, t)) }))
    .filter((b) => b.tickets.length > 0);

  const isToday = trip ? trip.departureDate === todayET() : true;
  const backHref = !trip || isToday ? "/admin" : `/admin/calendar?date=${trip.departureDate}`;
  const tripKind = trip
    ? tripLightKind({ ...trip, ticketsSold: liveTickets.length, scheduleId: undefined }, now)
    : null;

  return (
    <div className="flex flex-col gap-5">
      <div className="print:hidden flex flex-col gap-5">
        <Link
          href={backHref}
          className="self-start inline-flex items-center gap-1.5 min-h-tap-dock pl-1.5 pr-3.5 -my-2 -ml-1.5 text-body font-bold text-ob-ink no-underline rounded-ob hover:bg-ob-panel-2"
        >
          <ChevronLeftIcon size={20} />
          {isToday ? "Back to today" : "Back to the calendar"}
        </Link>

        {trip && (
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div className="flex-[1_1_420px] min-w-0">
              {tripKind && <StatusLight kind={tripKind} className="mb-2" />}
              <h1 className="text-title-page max-md:text-26 [text-wrap:balance]">
                {trip.product.displayName} · {trip.vessel.name}
              </h1>
              <div className="text-body text-ob-ink-2 mt-1.5">
                {fmtLongDateET(trip.departureDate)} · leaves{" "}
                <span className="font-num whitespace-nowrap">{fmtTimeET(trip.startTime)}</span>, back{" "}
                <span className="font-num whitespace-nowrap">{fmtTimeET(trip.endTime)}</span>
              </div>
            </div>
            <Button variant="secondary" size="dock" icon={<PrintIcon />} onClick={() => window.print()} disabled={!bookings}>
              Print the list
            </Button>
          </div>
        )}

        {error ? (
          <ErrorState onRetry={load} body={<>This trip&rsquo;s passenger list just can&rsquo;t load right now.</>} />
        ) : (
          <>
            <div className="grid grid-cols-2 xl:grid-cols-[2fr_1fr_1fr] bg-ob-panel border-2 border-ob-rule rounded-ob overflow-hidden">
              <ReadoutCell className="col-span-2 xl:col-span-1">
                <div className="text-body-sm font-semibold text-ob-ink-2">Checked in</div>
                <div className="flex items-baseline gap-2 mt-2.5 font-num leading-none">
                  <span className="text-readout-xl max-md:text-readout-l">{bookings ? checkedInCount : "—"}</span>
                  <span className="text-22 text-ob-ink-3">/{bookings ? liveTickets.length : "—"}</span>
                  <span className="font-ui text-18 font-bold text-ob-ink-2">aboard</span>
                </div>
                <div
                  role="img"
                  aria-label={`${checkedInCount} of ${liveTickets.length} aboard`}
                  className="h-2.5 mt-3 bg-ob-panel-2 shadow-[inset_0_0_0_1px_var(--ob-hair)]"
                >
                  <div
                    className="h-full bg-ob-go"
                    style={{ width: `${liveTickets.length ? Math.round((checkedInCount / liveTickets.length) * 100) : 0}%` }}
                  />
                </div>
                <div className="text-body-sm text-ob-ink-2 mt-2">
                  {!bookings
                    ? " "
                    : waitingCount
                      ? `${plural(waitingCount, "person", "people")} not here yet`
                      : "Everyone’s aboard"}
                </div>
              </ReadoutCell>
              <ReadoutCell>
                <div className="text-body-sm font-semibold text-ob-ink-2">Paid for this trip</div>
                <ReadoutValue size="l" className="mt-2.5">
                  {bookings ? fmtMoney(paidCents) : "—"}
                </ReadoutValue>
              </ReadoutCell>
              <ReadoutCell>
                <div className="text-body-sm font-semibold text-ob-ink-2">Tickets given back</div>
                <ReadoutValue size="l" className="mt-2.5">
                  {bookings ? String(refundedCount) : "—"}
                </ReadoutValue>
              </ReadoutCell>
            </div>

            <div className="sticky top-navbar z-10 -mx-1 px-1 py-2 bg-ob-bg">
              <Segmented
                label="Show"
                size="dock"
                fill
                className="bg-ob-panel md:max-w-[560px]"
                value={filter}
                onChange={setFilter}
                options={[
                  { value: "all", label: "Everyone", count: liveTickets.length },
                  { value: "waiting", label: "Not here", count: waitingCount },
                  { value: "aboard", label: "Aboard", count: checkedInCount },
                ]}
              />
            </div>

            {!bookings ? (
              <div className="bg-ob-panel border-2 border-ob-rule rounded-ob">
                <LoadingState variant="blocks" label="Loading who’s coming…" />
              </div>
            ) : bookings.length === 0 ? (
              <div className="bg-ob-panel border-2 border-ob-rule rounded-ob">
                <EmptyState title="Nobody has booked this trip yet." body="Seats are open on your website right now." />
              </div>
            ) : shown.length === 0 ? (
              <div className="flex items-center gap-2.5 px-5 py-7 bg-ob-panel border-2 border-ob-rule rounded-ob">
                <Lamp tone="go" />
                <span className="text-18 font-extrabold">
                  {filter === "waiting" ? "Everyone’s aboard." : "Nobody is aboard yet."}
                </span>
              </div>
            ) : density === "dock" ? (
              <BookingListDock shown={shown} actions={actions} />
            ) : (
              <>
                <div className="max-md:hidden">
                  <BookingTableDesk shown={shown} actions={actions} />
                </div>
                <div className="md:hidden">
                  <BookingListDeskPhone shown={shown} actions={actions} />
                </div>
              </>
            )}
          </>
        )}
      </div>

      {trip && bookings && <PrintSheet trip={trip} bookings={bookings} operatorName={operatorName} />}

      <Dialog
        open={!!refundTarget}
        onClose={() => setRefundTarget(null)}
        title="Refund one ticket"
        danger
        footer={
          <>
            <Button variant="secondary" onClick={() => setRefundTarget(null)} disabled={!!busyTicket}>
              Cancel
            </Button>
            <Button
              variant="danger-confirm"
              icon={<UndoIcon />}
              disabled={!!busyTicket}
              onClick={() => refundTarget && submitRefund(refundTarget.ticket.id)}
            >
              Refund this ticket{refundTarget ? ` · ${dollars(refundTarget.ticket.priceCents)}` : ""}
            </Button>
          </>
        }
      >
        {refundTarget && (
          <SummaryBox
            title={
              refundTarget.ticket.passengerName
                ? `${refundTarget.ticket.passengerName} · ${TICKET_LABEL[refundTarget.ticket.ticketType]}`
                : ticketLabel(refundTarget.ticket)
            }
            sub={`Booking ${refundTarget.booking.confirmationCode} · ${bookingName(refundTarget.booking)}`}
            aside={dollars(refundTarget.ticket.priceCents)}
          />
        )}
        <CautionBox>
          The amount goes back to the original card in a few days. The seat returns to sale. The rest of the booking is
          untouched. <strong>This cannot be undone.</strong>
        </CautionBox>
      </Dialog>
    </div>
  );
}
