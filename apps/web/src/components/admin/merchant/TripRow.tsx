"use client";

import { fmtTimeCompactET, fmtTimeET } from "@/lib/format";
import { useDensity } from "./DensityContext";
import { StatusLight, tripLightKind, type TripLightKind } from "./StatusLight";
import { Button } from "./Button";
import { PeopleIcon } from "./icons";
import { timeAndPeriodET, useNow } from "./clock";

export type TripRowData = {
  id: string;
  departureDate: string;
  startTime: string;
  endTime: string;
  capacity: number;
  /** Per-trip online-sales cutoff; null = the operator's default applies. */
  onlineCutoffMinutes: number | null;
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

type Row = {
  trip: TripRowData;
  kind: TripLightKind;
  cancelled: boolean;
  left: number;
  refunded: number;
};

function toRow(trip: TripRowData, now: number): Row {
  const kind = tripLightKind(trip, now);
  return {
    trip,
    kind,
    cancelled: kind === "cancelled",
    left: Math.max(0, trip.capacity - trip.ticketsSold),
    refunded: trip.refundedCount ?? trip.ticketsSold,
  };
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** The seat gauge's fill follows the trip light: departed ink-3, full go, 70%+ caution, else ink-2. */
function gaugeFill(row: Row): string {
  if (row.kind === "departed") return "bg-ob-ink-3";
  const r = row.trip.capacity > 0 ? row.trip.ticketsSold / row.trip.capacity : 0;
  if (r >= 1) return "bg-ob-go";
  if (r >= 0.7) return "bg-ob-caution";
  return "bg-ob-ink-2";
}

function gaugePct(trip: TripRowData) {
  return trip.capacity > 0 ? Math.min(100, Math.round((trip.ticketsSold / trip.capacity) * 100)) : 0;
}

function Gauge({ row, thin = false }: { row: Row; thin?: boolean }) {
  return (
    <div
      role="img"
      aria-label={`${row.trip.ticketsSold} of ${row.trip.capacity} seats booked`}
      className={`${thin ? "h-1.5 w-[72px] inline-block align-middle" : "h-2 mt-2"} bg-ob-panel-2 shadow-[inset_0_0_0_1px_var(--ob-hair)]`}
    >
      <div className={`h-full ${gaugeFill(row)}`} style={{ width: `${gaugePct(row.trip)}%` }} />
    </div>
  );
}

function BoatSwatch({ row, size = "md" }: { row: Row; size?: "md" | "sm" }) {
  return (
    <span
      aria-hidden="true"
      className={`flex-none ${size === "md" ? "w-4 h-1" : "w-3.5 h-1"} ${row.cancelled ? "bg-ob-ink-3" : ""}`}
      style={row.cancelled ? undefined : { backgroundColor: row.trip.vessel.color }}
    />
  );
}

function CancelledNote({ row }: { row: Row }) {
  return (
    <div className="text-body-sm text-ob-ink-2">
      Trip is off · <span className="font-num">{row.refunded}</span> {row.refunded === 1 ? "person" : "people"} refunded
    </div>
  );
}

const timeInk = (row: Row) => (row.cancelled || row.kind === "departed" ? "text-ob-ink-3" : "text-ob-ink");
const productCls = (row: Row) => (row.cancelled ? "text-ob-ink-3 line-through" : "text-ob-ink");
const rowBg = (row: Row) => (row.kind === "boarding" ? "bg-ob-go-tint" : "");

/** Renders as Dock rows or a Desk table, whichever the viewer has picked; phones get their own layouts. */
export function TripList({ trips, actions }: { trips: TripRowData[]; actions: TripRowActions }) {
  const { density } = useDensity();
  const now = useNow();
  const rows = trips.map((t) => toRow(t, now));
  return density === "dock" ? (
    <>
      <div role="list" className="hidden md:block">
        {rows.map((r) => (
          <DockRowWide key={r.trip.id} row={r} actions={actions} />
        ))}
      </div>
      <div role="list" className="md:hidden">
        {rows.map((r) => (
          <DockCardPhone key={r.trip.id} row={r} actions={actions} />
        ))}
      </div>
    </>
  ) : (
    <>
      <div className="hidden md:block overflow-x-auto">
        <DeskTable rows={rows} actions={actions} />
      </div>
      <div role="list" className="md:hidden">
        {rows.map((r) => (
          <DeskRowPhone key={r.trip.id} row={r} actions={actions} />
        ))}
      </div>
    </>
  );
}

function DockRowWide({ row, actions }: { row: Row; actions: TripRowActions }) {
  const { trip } = row;
  const { time, period } = timeAndPeriodET(trip.startTime);
  return (
    <div
      role="listitem"
      className={`grid items-center gap-x-5 gap-y-3 px-5 py-4 min-h-[92px] border-t border-ob-hair first:border-t-0 grid-cols-[104px_minmax(0,1.3fr)_minmax(150px,1fr)_150px] min-[1200px]:grid-cols-[104px_minmax(0,1.3fr)_minmax(150px,1fr)_150px_auto] ${rowBg(row)}`}
    >
      <div>
        <div className={`flex items-baseline gap-1 ${timeInk(row)}`}>
          <span className="font-num text-num-time">{time}</span>
          <span className="text-meta font-bold">{period}</span>
        </div>
        <div className="text-meta text-ob-ink-3 mt-1">back {fmtTimeET(trip.endTime)}</div>
      </div>
      <div className="min-w-0">
        <div className={`text-title-row ${productCls(row)}`}>{trip.product.displayName}</div>
        <div className="flex items-center gap-2 text-body-sm text-ob-ink-2 mt-0.5">
          <BoatSwatch row={row} />
          {trip.vessel.name}
        </div>
      </div>
      <div>
        {row.cancelled ? (
          <CancelledNote row={row} />
        ) : (
          <>
            <div className="flex items-baseline justify-between gap-2">
              <div className="font-num tabular-nums leading-none">
                <span className="text-num-gauge">{trip.ticketsSold}</span>
                <span className="text-body text-ob-ink-3">/{trip.capacity}</span>
              </div>
              <div className="text-meta text-ob-ink-2">
                {row.left === 0 ? "None left" : plural(row.left, "seat left", "seats left")}
              </div>
            </div>
            <Gauge row={row} />
          </>
        )}
      </div>
      <div>
        <StatusLight kind={row.kind} />
      </div>
      <div className="col-span-4 min-[1200px]:col-span-1 flex gap-2 justify-end min-[1200px]:min-w-[330px]">
        {!row.cancelled && (
          <>
            <Button variant="strong" icon={<PeopleIcon />} onClick={() => actions.onWhosComing(trip.id)}>
              Who&rsquo;s coming
            </Button>
            <Button variant="secondary" onClick={() => actions.onSeats(trip.id)}>
              Seats
            </Button>
            <Button variant="danger" onClick={() => actions.onCancel(trip.id)}>
              Cancel
            </Button>
          </>
        )}
      </div>
    </div>
  );
}

function DockCardPhone({ row, actions }: { row: Row; actions: TripRowActions }) {
  const { trip } = row;
  const { time, period } = timeAndPeriodET(trip.startTime);
  return (
    <div role="listitem" className={`flex flex-col gap-3 p-4 border-t-2 border-ob-rule first:border-t-0 ${rowBg(row)}`}>
      <div className="flex items-start justify-between gap-3">
        <div className={`flex flex-wrap items-baseline gap-x-1 ${timeInk(row)}`}>
          <span className="font-num text-num-time">{time}</span>
          <span className="text-body-sm font-bold">{period}</span>
          <span className="text-meta font-normal text-ob-ink-3 ml-1.5">back {fmtTimeET(trip.endTime)}</span>
        </div>
        <div className="pt-1.5">
          <StatusLight kind={row.kind} />
        </div>
      </div>
      <div>
        <div className={`text-title-row ${productCls(row)}`}>{trip.product.displayName}</div>
        <div className="flex items-center gap-2 text-body-sm text-ob-ink-2">
          <BoatSwatch row={row} />
          {trip.vessel.name}
        </div>
      </div>
      {row.cancelled ? (
        <CancelledNote row={row} />
      ) : (
        <>
          <div>
            <div className="flex items-baseline justify-between">
              <div className="font-num tabular-nums leading-none">
                <span className="text-24 font-medium">{trip.ticketsSold}</span>
                <span className="text-body text-ob-ink-3">/{trip.capacity}</span>
                <span className="font-ui text-body-sm text-ob-ink-2 ml-1.5">booked</span>
              </div>
              <div className="text-body-sm text-ob-ink-2">
                {row.left === 0 ? "None left" : plural(row.left, "seat left", "seats left")}
              </div>
            </div>
            <Gauge row={row} />
          </div>
          <Button
            variant="strong"
            size="main"
            icon={<PeopleIcon size={20} />}
            className="w-full text-17"
            onClick={() => actions.onWhosComing(trip.id)}
          >
            Who&rsquo;s coming
          </Button>
          <div className="grid grid-cols-2 gap-3">
            <Button variant="secondary" size="field" onClick={() => actions.onSeats(trip.id)}>
              Seats
            </Button>
            <Button variant="danger" size="field" onClick={() => actions.onCancel(trip.id)}>
              Cancel trip
            </Button>
          </div>
        </>
      )}
    </div>
  );
}

const TH = "py-2.5 px-3 text-meta font-bold text-ob-ink-2 whitespace-nowrap";

function DeskTable({ rows, actions }: { rows: Row[]; actions: TripRowActions }) {
  return (
    <table className="w-full border-collapse text-body-sm">
      <thead>
        <tr className="bg-ob-panel-2 text-left">
          <th scope="col" className={`${TH} pl-5`}>Leaves</th>
          <th scope="col" className={TH}>Back</th>
          <th scope="col" className={TH}>Boat</th>
          <th scope="col" className={TH}>Trip</th>
          <th scope="col" className={TH}>Booked</th>
          <th scope="col" className={`${TH} text-right`}>Left</th>
          <th scope="col" className={TH}>Status</th>
          <th scope="col" className={`${TH} pr-5 text-right`}>Change</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => {
          const { trip } = row;
          return (
            <tr key={trip.id} className={`border-t border-ob-hair ${rowBg(row)}`}>
              <td className={`py-1.5 pl-5 pr-3 font-num font-semibold whitespace-nowrap ${timeInk(row)}`}>
                {fmtTimeET(trip.startTime)}
              </td>
              <td className="py-1.5 px-3 font-num text-ob-ink-2 whitespace-nowrap">{fmtTimeET(trip.endTime)}</td>
              <td className="py-1.5 px-3 whitespace-nowrap">
                <span className="inline-flex items-center gap-2">
                  <BoatSwatch row={row} size="sm" />
                  {trip.vessel.name}
                </span>
              </td>
              <td className={`py-1.5 px-3 ${productCls(row)}`}>{trip.product.displayName}</td>
              <td className="py-1.5 px-3 whitespace-nowrap">
                {row.cancelled ? (
                  <span className="text-ob-ink-2">{row.refunded} refunded</span>
                ) : (
                  <span className="inline-flex items-center gap-2.5">
                    <span className="font-num tabular-nums min-w-16">
                      {trip.ticketsSold}/{trip.capacity}
                    </span>
                    <Gauge row={row} thin />
                  </span>
                )}
              </td>
              <td className="py-1.5 px-3 font-num text-right text-ob-ink-2">{row.cancelled ? "—" : row.left}</td>
              <td className="py-1.5 px-3 whitespace-nowrap">
                <StatusLight kind={row.kind} dense />
              </td>
              <td className="py-1.5 pl-3 pr-5 whitespace-nowrap text-right">
                {!row.cancelled && (
                  <span className="inline-flex gap-1.5">
                    <Button variant="strong" aria-label={`List: who's coming, ${fmtTimeET(trip.startTime)} ${trip.product.displayName}`} onClick={() => actions.onWhosComing(trip.id)}>
                      List
                    </Button>
                    <Button variant="secondary" aria-label={`Seats, ${fmtTimeET(trip.startTime)} ${trip.product.displayName}`} onClick={() => actions.onSeats(trip.id)}>
                      Seats
                    </Button>
                    <Button variant="danger" icon={false} aria-label={`Cancel, ${fmtTimeET(trip.startTime)} ${trip.product.displayName}`} onClick={() => actions.onCancel(trip.id)}>
                      Cancel
                    </Button>
                  </span>
                )}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function DeskRowPhone({ row, actions }: { row: Row; actions: TripRowActions }) {
  const { trip } = row;
  return (
    <div
      role="listitem"
      className={`grid grid-cols-[72px_minmax(0,1fr)_auto] gap-x-3 gap-y-1.5 items-center px-4 py-2.5 border-t-2 border-ob-rule first:border-t-0 ${rowBg(row)}`}
    >
      <div className={`font-num text-17 font-semibold ${timeInk(row)}`}>{fmtTimeCompactET(trip.startTime)}</div>
      <div className="min-w-0">
        <div className={`text-body-sm font-bold truncate ${productCls(row)}`}>
          {trip.vessel.name} · {trip.product.displayName}
        </div>
        <StatusLight kind={row.kind} dense className="[&>span:last-child]:text-meta" />
      </div>
      <div className="font-num text-body text-right tabular-nums">
        {row.cancelled ? `${row.refunded} ref.` : `${trip.ticketsSold}/${trip.capacity}`}
      </div>
      {!row.cancelled && (
        <div className="col-start-2 col-span-2 flex gap-1.5">
          <Button variant="strong" className="flex-1" onClick={() => actions.onWhosComing(trip.id)}>
            List
          </Button>
          <Button variant="secondary" className="flex-1" onClick={() => actions.onSeats(trip.id)}>
            Seats
          </Button>
          <Button variant="danger" icon={false} className="flex-1" onClick={() => actions.onCancel(trip.id)}>
            Cancel
          </Button>
        </div>
      )}
    </div>
  );
}
