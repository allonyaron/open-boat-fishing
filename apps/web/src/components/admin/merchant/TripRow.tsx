import { fmtTimeET } from "@/lib/format";
import { useDensity } from "./DensityContext";
import { StatusPill, tripPillStatus } from "./StatusPill";
import { TextButton } from "./Button";

export type TripRowData = {
  id: string;
  startTime: string;
  endTime: string;
  capacity: number;
  ticketsSold: number;
  status: string;
  scheduleId: string | null;
  vessel: { name: string; color: string };
  product: { displayName: string };
  /** Only meaningful when status === "cancelled" — how many people were refunded. */
  refundedCount?: number;
};

export type TripRowActions = {
  onWhosComing: (tripId: string) => void;
  onSeats: (tripId: string) => void;
  onCancel: (tripId: string) => void;
};

/** Renders as a Dock card list or a Desk table, whichever the viewer has picked. */
export function TripList({ trips, actions }: { trips: TripRowData[]; actions: TripRowActions }) {
  const { density } = useDensity();
  return density === "dock" ? (
    <div className="flex flex-col">
      {trips.map((t) => (
        <TripRowDock key={t.id} trip={t} actions={actions} />
      ))}
    </div>
  ) : (
    <TripTableDesk trips={trips} actions={actions} />
  );
}

function seatsLabel(trip: TripRowData) {
  if (trip.status === "cancelled") {
    const n = trip.refundedCount ?? trip.ticketsSold;
    return `${n} ${n === 1 ? "person" : "people"} refunded`;
  }
  return `${trip.ticketsSold} of ${trip.capacity} booked`;
}

function TripRowDock({ trip, actions }: { trip: TripRowData; actions: TripRowActions }) {
  const cancelled = trip.status === "cancelled";
  const pct = trip.capacity > 0 ? Math.min(100, (trip.ticketsSold / trip.capacity) * 100) : 0;
  const pillStatus = tripPillStatus(trip);
  const barColor = cancelled
    ? "bg-merchant-disabled"
    : pillStatus === "sold-out"
      ? "bg-merchant-green"
      : "bg-merchant-blue";

  return (
    <div className={`flex items-stretch gap-3 border-t border-merchant-hairline px-4 py-3.5 first:border-t-0 ${cancelled ? "bg-merchant-fill" : ""}`}>
      <div
        className="w-1 min-h-11 rounded-full flex-shrink-0"
        style={{ backgroundColor: cancelled ? "#b5b5b5" : trip.vessel.color }}
      />
      <div className="flex-shrink-0 w-[92px]">
        <div className="text-15 font-bold text-merchant-ink">{fmtTimeET(trip.startTime)}</div>
        <div className="text-12 text-merchant-faint">back {fmtTimeET(trip.endTime)}</div>
      </div>
      <div className="flex-1 min-w-0">
        <div className={`text-14 font-semibold ${cancelled ? "text-merchant-disabled" : "text-merchant-ink"}`}>
          {trip.product.displayName} · {trip.vessel.name}
        </div>
        {!cancelled && (
          <div className="mt-1.5 h-1.5 max-w-[260px] rounded-full bg-merchant-hairline overflow-hidden">
            <div className={`h-full rounded-full ${barColor}`} style={{ width: `${pct}%` }} />
          </div>
        )}
        <div className="mt-1 text-13 text-merchant-muted">
          {cancelled ? "trip is off" : seatsLabel(trip)}
          {!cancelled && (
            <span className="text-merchant-faint"> · {Math.max(0, trip.capacity - trip.ticketsSold)} seats left</span>
          )}
        </div>
      </div>
      <div className="flex flex-col items-end justify-between flex-shrink-0 gap-2">
        <StatusPill status={pillStatus} />
        {!cancelled && (
          <div className="flex gap-3">
            <TextButton onClick={() => actions.onWhosComing(trip.id)}>Who&rsquo;s coming</TextButton>
            <TextButton onClick={() => actions.onSeats(trip.id)}>Seats</TextButton>
            <TextButton onClick={() => actions.onCancel(trip.id)}>Cancel</TextButton>
          </div>
        )}
      </div>
    </div>
  );
}

function TripTableDesk({ trips, actions }: { trips: TripRowData[]; actions: TripRowActions }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[620px] text-13">
        <thead>
          <tr className="bg-merchant-fill text-left">
            {["Leaves", "Boat", "Trip", "Booked", "Status", "Change"].map((h) => (
              <th key={h} className="px-4 py-2 text-12 font-semibold text-merchant-muted">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {trips.map((trip) => {
            const cancelled = trip.status === "cancelled";
            return (
              <tr key={trip.id} className={`border-t border-merchant-hairline ${cancelled ? "bg-merchant-fill" : ""}`}>
                <td className="px-4 py-2.5 font-semibold text-merchant-ink whitespace-nowrap">
                  {fmtTimeET(trip.startTime)}
                </td>
                <td className="px-4 py-2.5 whitespace-nowrap">
                  <span className="inline-flex items-center gap-1.5">
                    <span
                      className="w-2 h-2 rounded-full inline-block"
                      style={{ backgroundColor: cancelled ? "#b5b5b5" : trip.vessel.color }}
                    />
                    {trip.vessel.name}
                  </span>
                </td>
                <td className="px-4 py-2.5">{trip.product.displayName}</td>
                <td className="px-4 py-2.5 whitespace-nowrap tabular-nums">
                  {cancelled ? seatsLabel(trip) : `${trip.ticketsSold}/${trip.capacity}`}
                </td>
                <td className="px-4 py-2.5">
                  <StatusPill status={tripPillStatus(trip)} />
                </td>
                <td className="px-4 py-2.5 whitespace-nowrap">
                  {!cancelled && (
                    <div className="flex gap-3">
                      <TextButton onClick={() => actions.onWhosComing(trip.id)}>List</TextButton>
                      <TextButton onClick={() => actions.onSeats(trip.id)}>Seats</TextButton>
                      <TextButton onClick={() => actions.onCancel(trip.id)}>Cancel</TextButton>
                    </div>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
