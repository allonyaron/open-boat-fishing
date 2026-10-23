"use client";

import { useEffect, useState } from "react";
import { fmtTimeET } from "@/lib/format";
import { CautionBox, Dialog, SummaryBox } from "./Dialog";
import { Button } from "./Button";
import { FieldError, HelpText, Input, Label, Select, Stepper } from "./Input";
import type { TripRowData } from "./TripRow";

export type ProductOption = { id: string; displayName: string; vessel: { name: string } };

/** The trip a dialog is about — enough for its summary line. */
export type DialogTrip = Pick<TripRowData, "startTime" | "ticketsSold" | "product" | "vessel">;

const CANCEL_REASONS = [
  { value: "weather", label: "Weather — it isn't safe to go out" },
  { value: "mechanical", label: "Engine or boat trouble" },
  { value: "low_bookings", label: "Not enough people booked" },
];

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export function CancelDialog({
  open,
  busy,
  trip,
  onClose,
  onConfirm,
}: {
  open: boolean;
  busy: boolean;
  trip?: DialogTrip | null;
  onClose: () => void;
  onConfirm: (reason: string) => void;
}) {
  const [reason, setReason] = useState(CANCEL_REASONS[0].value);
  useEffect(() => {
    if (open) setReason(CANCEL_REASONS[0].value);
  }, [open]);
  const booked = trip?.ticketsSold ?? 0;
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Cancel trip"
      danger
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Keep the trip
          </Button>
          <Button variant="danger-confirm" onClick={() => onConfirm(reason)} disabled={busy}>
            Cancel and refund{booked > 0 ? ` (${booked})` : ""}
          </Button>
        </>
      }
    >
      {trip && (
        <SummaryBox
          title={`${fmtTimeET(trip.startTime)} · ${trip.product.displayName}`}
          sub={`${trip.vessel.name} · ${plural(booked, "person", "people")} booked`}
        />
      )}
      <fieldset className="flex flex-col gap-2 border-0 m-0 p-0">
        <legend className="text-body-sm font-bold mb-2 p-0">Reason</legend>
        {CANCEL_REASONS.map((r) => {
          const on = reason === r.value;
          return (
            <label
              key={r.value}
              className={`flex items-center gap-3.5 min-h-field px-3.5 border-2 rounded-ob cursor-pointer has-[:focus-visible]:outline has-[:focus-visible]:outline-[3px] has-[:focus-visible]:outline-ob-focus has-[:focus-visible]:outline-offset-2 ${
                on ? "border-ob-ink bg-ob-panel-2" : "border-ob-control"
              }`}
            >
              <input
                type="radio"
                name="cancel-reason"
                value={r.value}
                checked={on}
                onChange={() => setReason(r.value)}
                className="sr-only"
              />
              <span
                aria-hidden="true"
                className="flex items-center justify-center w-[22px] h-[22px] flex-none border-2 border-ob-ink rounded-full"
              >
                <span className={`w-2.5 h-2.5 rounded-full ${on ? "bg-ob-ink" : ""}`} />
              </span>
              <span className="text-body">{r.label}</span>
            </label>
          );
        })}
      </fieldset>
      <CautionBox>
        Everyone is refunded automatically and notified. If a customer booked this trip with another, only this trip is
        refunded. <strong>This cannot be undone.</strong>
      </CautionBox>
    </Dialog>
  );
}

export type TripSettings = { capacity: number; onlineCutoffMinutes: number | null };

export function SeatsDialog({
  open,
  busy,
  trip,
  currentCapacity,
  currentCutoffMinutes,
  onClose,
  onConfirm,
}: {
  open: boolean;
  busy: boolean;
  trip?: DialogTrip | null;
  currentCapacity: number;
  currentCutoffMinutes: number | null;
  onClose: () => void;
  onConfirm: (settings: TripSettings) => void;
}) {
  const [value, setValue] = useState(currentCapacity);
  // Blank = no override; the trip follows the default set in Settings.
  const [cutoff, setCutoff] = useState(currentCutoffMinutes === null ? "" : String(currentCutoffMinutes));
  useEffect(() => setValue(currentCapacity), [currentCapacity, open]);
  useEffect(
    () => setCutoff(currentCutoffMinutes === null ? "" : String(currentCutoffMinutes)),
    [currentCutoffMinutes, open],
  );
  const cutoffValid = cutoff === "" || (Number.isInteger(Number(cutoff)) && Number(cutoff) >= 0);
  const seatsValid = Number.isInteger(value) && value >= 1;
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Seats on this trip"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button
            variant="key"
            className="px-7"
            onClick={() => onConfirm({ capacity: value, onlineCutoffMinutes: cutoff === "" ? null : Number(cutoff) })}
            disabled={busy || !seatsValid || !cutoffValid}
          >
            Save
          </Button>
        </>
      }
    >
      {trip && (
        <div className="text-body-sm text-ob-ink-2">
          {fmtTimeET(trip.startTime)} · {trip.product.displayName} · {trip.vessel.name}
        </div>
      )}
      <div>
        <Label htmlFor="seats">Seats</Label>
        <Stepper
          id="seats"
          value={value}
          onChange={setValue}
          min={1}
          decrementLabel="One fewer seat"
          incrementLabel="One more seat"
          invalid={!seatsValid}
          describedBy="seats-note"
        />
        {trip && (
          <HelpText id="seats-note">{plural(trip.ticketsSold, "person has", "people have")} already booked.</HelpText>
        )}
      </div>
      <div>
        <Label htmlFor="online-cutoff">Stop online sales (minutes before departure)</Label>
        <Input
          id="online-cutoff"
          type="number"
          inputMode="numeric"
          min={0}
          value={cutoff}
          placeholder="Use my default"
          invalid={!cutoffValid}
          aria-describedby={cutoffValid ? undefined : "online-cutoff-error"}
          onChange={(e) => setCutoff(e.target.value)}
        />
        {!cutoffValid && <FieldError id="online-cutoff-error">Use a whole number, 0 or more.</FieldError>}
      </div>
      <p className="m-0 text-body-sm text-ob-ink-2 [text-wrap:pretty]">
        Just this one trip. Your weekly schedule stays as it is. Leave online sales blank to use the default from
        Settings.
      </p>
    </Dialog>
  );
}

export function AddDepartureDialog({
  open,
  busy,
  products,
  dateLabel,
  onClose,
  onConfirm,
}: {
  open: boolean;
  busy: boolean;
  products: ProductOption[];
  /** Which day this one-off departure lands on, shown as copy — e.g. "September 23". */
  dateLabel: string;
  onClose: () => void;
  onConfirm: (form: { productId: string; departureTime: string; returnTime: string; capacity: number }) => void;
}) {
  const [productId, setProductId] = useState("");
  const [departureTime, setDepartureTime] = useState("07:00");
  const [returnTime, setReturnTime] = useState("12:00");
  const [capacity, setCapacity] = useState(20);

  useEffect(() => {
    if (open && products.length > 0 && !productId) setProductId(products[0].id);
  }, [open, products, productId]);

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Add a departure"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button
            variant="key"
            disabled={busy || !productId}
            onClick={() => onConfirm({ productId, departureTime, returnTime, capacity })}
          >
            Add departure
          </Button>
        </>
      }
    >
      <p className="m-0 text-body-sm text-ob-ink-2">
        Adding a one-off departure for {dateLabel}. Your weekly schedule won&rsquo;t change.
      </p>
      <div>
        <Label htmlFor="trip-type">Trip type</Label>
        <Select id="trip-type" value={productId} onChange={(e) => setProductId(e.target.value)}>
          {products.map((p) => (
            <option key={p.id} value={p.id}>
              {p.displayName} · {p.vessel.name}
            </option>
          ))}
        </Select>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label htmlFor="leaves">Leaves</Label>
          <Input id="leaves" type="time" value={departureTime} onChange={(e) => setDepartureTime(e.target.value)} />
        </div>
        <div>
          <Label htmlFor="back">Back</Label>
          <Input id="back" type="time" value={returnTime} onChange={(e) => setReturnTime(e.target.value)} />
        </div>
      </div>
      <div>
        <Label htmlFor="add-capacity">Seats</Label>
        <Input
          id="add-capacity"
          type="number"
          inputMode="numeric"
          min={1}
          value={capacity}
          className="max-w-[200px]"
          onChange={(e) => setCapacity(Number(e.target.value))}
        />
      </div>
    </Dialog>
  );
}
