"use client";

import { useEffect, useState } from "react";
import { Dialog } from "./Dialog";
import { Button } from "./Button";
import { Input, Label, Select } from "./Input";

export type ProductOption = { id: string; displayName: string; vessel: { name: string } };

const CANCEL_REASONS = [
  { value: "weather", label: "Weather — it isn't safe to go out" },
  { value: "mechanical", label: "Engine or boat trouble" },
  { value: "low_bookings", label: "Not enough people booked" },
];

export function CancelDialog({
  open,
  busy,
  onClose,
  onConfirm,
}: {
  open: boolean;
  busy: boolean;
  onClose: () => void;
  onConfirm: (reason: string) => void;
}) {
  const [reason, setReason] = useState(CANCEL_REASONS[0].value);
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Cancel trip"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Keep the trip
          </Button>
          <Button variant="destructive" onClick={() => onConfirm(reason)} disabled={busy}>
            Cancel and refund
          </Button>
        </>
      }
    >
      <Label htmlFor="cancel-reason">Reason</Label>
      <Select id="cancel-reason" value={reason} onChange={(e) => setReason(e.target.value)}>
        {CANCEL_REASONS.map((r) => (
          <option key={r.value} value={r.value}>
            {r.label}
          </option>
        ))}
      </Select>
      <div className="mt-4 rounded-lg bg-merchant-amber-soft px-3 py-2.5 text-13 text-merchant-amber-deep">
        Everyone is refunded automatically and notified. If a customer booked this trip with another, only this trip
        is refunded. This cannot be undone.
      </div>
    </Dialog>
  );
}

export function SeatsDialog({
  open,
  busy,
  currentCapacity,
  onClose,
  onConfirm,
}: {
  open: boolean;
  busy: boolean;
  currentCapacity: number;
  onClose: () => void;
  onConfirm: (capacity: number) => void;
}) {
  const [value, setValue] = useState(currentCapacity);
  useEffect(() => setValue(currentCapacity), [currentCapacity, open]);
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
          <Button variant="primary" onClick={() => onConfirm(value)} disabled={busy || value < 1}>
            Save seats
          </Button>
        </>
      }
    >
      <Label htmlFor="seats">Seats</Label>
      <Input id="seats" type="number" min={1} value={value} onChange={(e) => setValue(Number(e.target.value))} />
      <p className="mt-2 text-13 text-merchant-muted">Just this one trip. Your weekly schedule stays as it is.</p>
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
            variant="primary"
            disabled={busy || !productId}
            onClick={() => onConfirm({ productId, departureTime, returnTime, capacity })}
          >
            Add departure
          </Button>
        </>
      }
    >
      <p className="text-13 text-merchant-muted mb-3">
        Adding a one-off departure for {dateLabel}. Your weekly schedule won&rsquo;t change.
      </p>
      <div className="flex flex-col gap-3">
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
            min={1}
            value={capacity}
            onChange={(e) => setCapacity(Number(e.target.value))}
          />
        </div>
      </div>
    </Dialog>
  );
}
