"use client";

import { fmtTimeET } from "@/lib/format";
import { Button, StatusLight, useDensity, fmtMoney, ticketLightKind, CheckAllIcon, CheckIcon, NoteIcon, UndoIcon } from "@/components/admin/merchant";
import {
  bookingName,
  telHref,
  ticketLabel,
  ticketTypeLabel,
  waitingTickets,
  type BookingData,
  type TicketData,
} from "./types";

export type PassengerActions = {
  onToggle: (ticket: TicketData) => void;
  onRefund: (ticket: TicketData, booking: BookingData) => void;
  onAllAboard: (booking: BookingData) => void;
  busyTicket: string | null;
  busyBooking: string | null;
};

/** Bookings after the filter: each keeps only its matching tickets; `all` is the unfiltered booking. */
export type ShownBooking = { booking: BookingData; tickets: TicketData[] };

function checkedInTime(t: TicketData): string {
  return t.checkedIn && t.checkedInAt ? fmtTimeET(t.checkedInAt) : "";
}

function AllAboardButton({
  booking,
  actions,
  className = "",
}: {
  booking: BookingData;
  actions: PassengerActions;
  className?: string;
}) {
  const waiting = waitingTickets(booking);
  if (waiting.length < 2) return null;
  return (
    <Button
      variant="strong"
      icon={<CheckAllIcon />}
      className={className}
      disabled={actions.busyBooking === booking.id}
      onClick={() => actions.onAllAboard(booking)}
    >
      All {waiting.length} aboard
    </Button>
  );
}

/**
 * Tap-to-call. It reads as inline text, but the padding (cancelled out by the
 * negative margin) stretches the hit area to the density's tap height.
 */
function Phone({ phone, className = "" }: { phone: string | null; className?: string }) {
  const { density } = useDensity();
  if (!phone) return null;
  const hit = density === "dock" ? "py-[13px] -my-[13px]" : "py-2 -my-2";
  return (
    <a href={telHref(phone)} className={`inline-block font-num underline underline-offset-[3px] ${hit} ${className}`}>
      {phone}
    </a>
  );
}

// ── Dock: booking cards, one ticket per row with big Aboard / Undo / Refund ──

export function BookingListDock({ shown, actions }: { shown: ShownBooking[]; actions: PassengerActions }) {
  return (
    <div role="list" className="bg-ob-panel border-2 border-ob-rule rounded-ob">
      {shown.map(({ booking, tickets }) => (
        <div role="listitem" key={booking.id} className="border-t-2 border-ob-rule first:border-t-0">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2.5 px-5 pt-4 pb-3 max-md:px-4 max-md:pb-2.5">
            <div className="flex-[1_1_240px] min-w-0">
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <span className="text-19 font-extrabold">{bookingName(booking)}</span>
                <span className="font-num text-meta text-ob-ink-3">{booking.confirmationCode}</span>
              </div>
              <div className="flex flex-wrap gap-x-3.5 gap-y-0.5 text-body-sm text-ob-ink-2 mt-0.5">
                <Phone phone={booking.customerPhone} className="text-ob-ink" />
                <span className="[overflow-wrap:anywhere]">{booking.customerEmail}</span>
              </div>
            </div>
            <AllAboardButton booking={booking} actions={actions} className="max-md:flex-[1_1_100%]" />
          </div>
          {booking.notes && (
            <div className="flex gap-2.5 mx-5 mb-3 px-3 py-2.5 bg-ob-caution-tint shadow-[inset_0_0_0_1px_var(--ob-caution)] text-body-sm max-md:mx-4">
              <span className="text-ob-caution-ink mt-0.5">
                <NoteIcon />
              </span>
              <span className="[text-wrap:pretty]">{booking.notes}</span>
            </div>
          )}
          {tickets.map((t) => (
            <TicketRowDock key={t.id} ticket={t} booking={booking} actions={actions} />
          ))}
        </div>
      ))}
    </div>
  );
}

function TicketRowDock({
  ticket,
  booking,
  actions,
}: {
  ticket: TicketData;
  booking: BookingData;
  actions: PassengerActions;
}) {
  const busy = actions.busyTicket === ticket.id || actions.busyBooking === booking.id;
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-3 px-5 py-3 border-t border-ob-hair max-md:px-4 max-md:pb-3.5">
      <div className="flex-[1_1_220px] min-w-0 flex flex-col gap-1">
        <div className="flex items-center gap-2.5">
          <StatusLight kind={ticketLightKind(ticket)} />
          <span className="font-num text-meta text-ob-ink-3">{checkedInTime(ticket)}</span>
        </div>
        <div className={`flex items-baseline gap-2.5 ${ticket.voided ? "line-through" : ""}`}>
          <span className={`text-title-row ${ticket.voided ? "text-ob-ink-3" : "text-ob-ink"}`}>{ticketLabel(ticket)}</span>
          <span className="text-body-sm text-ob-ink-2">{ticketTypeLabel(ticket)}</span>
          <span className="font-num text-body-sm text-ob-ink-3 ml-auto">{fmtMoney(ticket.priceCents)}</span>
        </div>
      </div>
      {ticket.voided ? (
        <div className="text-body-sm text-ob-ink-3">Seat is back on sale</div>
      ) : (
        <div className="flex gap-2.5 max-md:flex-[1_1_100%]">
          {ticket.checkedIn ? (
            <Button
              variant="secondary"
              className="flex-auto min-w-[150px] max-md:min-h-tap-main"
              disabled={busy}
              onClick={() => actions.onToggle(ticket)}
            >
              Undo
            </Button>
          ) : (
            <Button
              variant="key"
              icon={<CheckIcon size={20} />}
              className="flex-auto min-w-[150px] text-17 font-extrabold max-md:min-h-tap-main"
              disabled={busy}
              onClick={() => actions.onToggle(ticket)}
            >
              Aboard
            </Button>
          )}
          <Button
            variant="danger"
            icon={<UndoIcon size={16} />}
            className="flex-none min-w-[112px] max-md:min-h-tap-main"
            disabled={busy}
            onClick={() => actions.onRefund(ticket, booking)}
          >
            Refund
          </Button>
        </div>
      )}
    </div>
  );
}

// ── Desk, wide screens: one table, a booking header row then its tickets ──

const TH = "py-2.5 px-3 text-meta font-bold text-ob-ink-2";

export function BookingTableDesk({ shown, actions }: { shown: ShownBooking[]; actions: PassengerActions }) {
  return (
    <div className="bg-ob-panel border-2 border-ob-rule rounded-ob overflow-x-auto">
      <table className="w-full border-collapse text-body-sm">
        <thead>
          <tr className="bg-ob-panel-2 text-left">
            <th scope="col" className={`${TH} pl-4`}>Who</th>
            <th scope="col" className={TH}>Ticket</th>
            <th scope="col" className={`${TH} text-right`}>Paid</th>
            <th scope="col" className={TH}>Status</th>
            <th scope="col" className={`${TH} pr-4 text-right`}>Change</th>
          </tr>
        </thead>
        <tbody>
          {shown.map(({ booking, tickets }) => (
            <BookingRowsDesk key={booking.id} booking={booking} tickets={tickets} actions={actions} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function BookingRowsDesk({
  booking,
  tickets,
  actions,
}: {
  booking: BookingData;
  tickets: TicketData[];
  actions: PassengerActions;
}) {
  return (
    <>
      <tr className="border-t-2 border-ob-rule bg-ob-panel">
        <td colSpan={5} className="pt-2.5 pb-1.5 px-4">
          <div className="flex flex-wrap items-baseline gap-x-3.5 gap-y-1">
            <span className="text-body font-extrabold">{bookingName(booking)}</span>
            <span className="font-num text-meta text-ob-ink-3">{booking.confirmationCode}</span>
            <Phone phone={booking.customerPhone} className="text-meta text-ob-ink-2" />
            <span className="text-meta text-ob-ink-2">{booking.customerEmail}</span>
            {booking.notes && <span className="text-meta font-semibold text-ob-caution-ink">Note: {booking.notes}</span>}
            <AllAboardButton booking={booking} actions={actions} className="ml-auto" />
          </div>
        </td>
      </tr>
      {tickets.map((t) => {
        const busy = actions.busyTicket === t.id || actions.busyBooking === booking.id;
        const strike = t.voided ? "line-through" : "";
        return (
          <tr key={t.id} className="border-t border-ob-hair">
            <td className={`py-1 pl-8 pr-4 ${t.voided ? "text-ob-ink-3" : "text-ob-ink"} ${strike}`}>{ticketLabel(t)}</td>
            <td className={`py-1 px-3 text-ob-ink-2 ${strike}`}>{ticketTypeLabel(t)}</td>
            <td className={`py-1 px-3 font-num text-right ${strike}`}>{fmtMoney(t.priceCents)}</td>
            <td className="py-1 px-3 whitespace-nowrap">
              <span className="inline-flex items-center gap-2">
                <StatusLight kind={ticketLightKind(t)} />
                <span className="font-num text-meta text-ob-ink-3">{checkedInTime(t)}</span>
              </span>
            </td>
            <td className="py-1 pl-3 pr-4 text-right whitespace-nowrap">
              {t.voided ? (
                <span className="text-ob-ink-3">Seat is back on sale</span>
              ) : (
                <span className="inline-flex gap-1.5">
                  {t.checkedIn ? (
                    <Button variant="secondary" className="min-w-[84px]" disabled={busy} onClick={() => actions.onToggle(t)}>
                      Undo
                    </Button>
                  ) : (
                    <Button
                      variant="key"
                      className="min-w-[84px] font-extrabold"
                      disabled={busy}
                      onClick={() => actions.onToggle(t)}
                    >
                      Aboard
                    </Button>
                  )}
                  <Button variant="danger" icon={false} disabled={busy} onClick={() => actions.onRefund(t, booking)}>
                    Refund
                  </Button>
                </span>
              )}
            </td>
          </tr>
        );
      })}
    </>
  );
}

// ── Desk, phones: compact rows ──

export function BookingListDeskPhone({ shown, actions }: { shown: ShownBooking[]; actions: PassengerActions }) {
  return (
    <div role="list" className="bg-ob-panel border-2 border-ob-rule rounded-ob">
      {shown.map(({ booking, tickets }) => (
        <div role="listitem" key={booking.id} className="border-t-2 border-ob-rule first:border-t-0">
          <div className="flex items-center gap-2 px-3 pt-2.5 pb-1.5">
            <div className="flex-1 min-w-0">
              <div className="text-body font-extrabold truncate">
                {bookingName(booking)}
                <span className="ml-2 font-num text-meta font-normal text-ob-ink-3">{booking.confirmationCode}</span>
              </div>
              <Phone phone={booking.customerPhone} className="text-meta text-ob-ink-2" />
            </div>
            <AllAboardButton booking={booking} actions={actions} className="text-meta px-2.5" />
          </div>
          {booking.notes && (
            <div className="mx-3 mb-1.5 text-meta font-semibold text-ob-caution-ink">Note: {booking.notes}</div>
          )}
          {tickets.map((t) => {
            const busy = actions.busyTicket === t.id || actions.busyBooking === booking.id;
            const kind = ticketLightKind(t);
            return (
              <div key={t.id} className="flex items-center gap-2 px-3 py-1.5 border-t border-ob-hair">
                <div className="flex-1 min-w-0">
                  <div
                    className={`text-body-sm font-bold truncate ${t.voided ? "text-ob-ink-3 line-through" : "text-ob-ink"}`}
                  >
                    {ticketLabel(t)}
                  </div>
                  <div className="flex items-center gap-1.5 text-meta text-ob-ink-2">
                    <StatusLight kind={kind} dense className="[&>span:last-child]:text-meta" />
                    <span>· {fmtMoney(t.priceCents)}</span>
                  </div>
                </div>
                {!t.voided &&
                  (t.checkedIn ? (
                    <Button variant="secondary" className="min-w-[84px]" disabled={busy} onClick={() => actions.onToggle(t)}>
                      Undo
                    </Button>
                  ) : (
                    <Button variant="key" className="min-w-[84px] font-extrabold" disabled={busy} onClick={() => actions.onToggle(t)}>
                      Aboard
                    </Button>
                  ))}
                {!t.voided && (
                  <Button variant="danger" icon={false} className="px-2.5" disabled={busy} onClick={() => actions.onRefund(t, booking)}>
                    Refund
                  </Button>
                )}
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}
