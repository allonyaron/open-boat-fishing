import { fmtLongDateET, fmtTimeET } from "@/lib/format";
import { bookingName, TICKET_LABEL, type BookingData, type TripDetail } from "./types";

const PRINTED_DAY = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  weekday: "short",
  month: "short",
  day: "numeric",
});

/**
 * The passenger list as paper: hidden on screen, shown only by @media print.
 * Every booking and ticket, whatever the on-screen filter. Always black on
 * white — ob-tokens.css swaps in the Sunlight values for print.
 */
export function PrintSheet({
  trip,
  bookings,
  operatorName,
}: {
  trip: TripDetail;
  bookings: BookingData[];
  operatorName: string | null;
}) {
  const all = bookings.flatMap((b) => b.tickets);
  const live = all.filter((t) => !t.voided);
  const aboard = live.filter((t) => t.checkedIn).length;
  const printedAt = new Date();

  return (
    <div className="hidden print:block bg-ob-panel text-ob-ink font-ui">
      <div className="flex justify-between items-end gap-4 pb-3 border-b-[3px] border-ob-ink">
        <div>
          <div className="text-13 font-bold tracking-[0.06em] uppercase">
            Passenger list{operatorName ? ` · ${operatorName}` : ""}
          </div>
          <div className="text-26 font-extrabold tracking-[-0.01em] mt-1">
            {trip.product.displayName} · {trip.vessel.name}
          </div>
          <div className="text-15 mt-0.5">
            {fmtLongDateET(trip.departureDate)} · leaves {fmtTimeET(trip.startTime)}, back {fmtTimeET(trip.endTime)}
          </div>
        </div>
        <div className="text-right font-num text-15 leading-normal">
          <div>{live.length} booked</div>
          <div>{aboard} checked in</div>
          <div>{all.length - live.length} refunded</div>
        </div>
      </div>
      <table className="w-full border-collapse text-14 mt-3">
        <thead>
          <tr className="text-left border-b-2 border-ob-ink">
            <th scope="col" className="py-1.5 pr-1.5 w-[34px]">
              ✓
            </th>
            <th scope="col" className="p-1.5">Name</th>
            <th scope="col" className="p-1.5">Ticket</th>
            <th scope="col" className="p-1.5">Booking</th>
            <th scope="col" className="p-1.5">Phone</th>
          </tr>
        </thead>
        <tbody>
          {bookings.map((b) =>
            b.tickets.map((t, j) => {
              const first = j === 0;
              const name = first
                ? bookingName(b) + (t.passengerName && t.passengerName !== bookingName(b) ? ` — ${t.passengerName}` : "")
                : t.passengerName ?? `↳ ${TICKET_LABEL[t.ticketType]} ticket`;
              const strike = t.voided ? "line-through" : "";
              const last = j === b.tickets.length - 1;
              return [
                <tr key={t.id} className="border-b border-ob-hair break-inside-avoid">
                  <td className="py-[5px] pr-1.5">
                    <span className="inline-flex items-center justify-center w-[18px] h-[18px] border-2 border-ob-ink text-13 font-extrabold">
                      {t.checkedIn ? "✓" : ""}
                    </span>
                  </td>
                  <td className={`py-[5px] px-1.5 ${first ? "font-bold" : ""} ${strike}`}>{name}</td>
                  <td className={`py-[5px] px-1.5 ${strike}`}>{TICKET_LABEL[t.ticketType]}</td>
                  <td className="py-[5px] px-1.5 font-num">{first ? b.confirmationCode : ""}</td>
                  <td className="py-[5px] px-1.5 font-num">{first ? b.customerPhone ?? "" : ""}</td>
                </tr>,
                last && b.notes ? (
                  <tr key={`${t.id}-note`} className="break-inside-avoid">
                    <td />
                    <td colSpan={4} className="pt-0.5 pb-1.5 px-1.5 text-13 italic">
                      Note: {b.notes}
                    </td>
                  </tr>
                ) : null,
              ];
            }),
          )}
        </tbody>
      </table>
      <div className="mt-3.5 text-12">
        Printed {PRINTED_DAY.format(printedAt)} at {fmtTimeET(printedAt)} ET · ✓ = already checked in · struck through =
        refunded
      </div>
    </div>
  );
}
