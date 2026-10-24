"use client";

import { useEffect, useState } from "react";
import { Dialog } from "./Dialog";
import { Button } from "./Button";
import { FieldError, Input, Label, Select } from "./Input";
import { datesInRange, VALID_DAYS, type DayOfWeek } from "@/lib/trip-materialization";
import type { ProductOption } from "./TripDialogs";

const DAY_NAMES: Record<DayOfWeek, string> = {
  mon: "Monday",
  tue: "Tuesday",
  wed: "Wednesday",
  thu: "Thursday",
  fri: "Friday",
  sat: "Saturday",
  sun: "Sunday",
};

const DAY_LABELS: Record<DayOfWeek, string> = {
  mon: "Mo",
  tue: "Tu",
  wed: "We",
  thu: "Th",
  fri: "Fr",
  sat: "Sa",
  sun: "Su",
};

export type SchedulePatternInput = {
  productId: string;
  daysOfWeek: DayOfWeek[];
  departureTime: string;
  returnTime: string;
  capacity: number;
  startDate: string;
  endDate: string;
};

const DEFAULTS: Omit<SchedulePatternInput, "productId"> = {
  daysOfWeek: ["sat", "sun"],
  departureTime: "07:00",
  returnTime: "12:00",
  capacity: 20,
  startDate: "",
  endDate: "",
};

export function ScheduleDialog({
  open,
  busy,
  products,
  initial,
  onClose,
  onConfirm,
}: {
  open: boolean;
  busy: boolean;
  products: ProductOption[];
  /** Pre-fill for "Change" on an existing pattern; omit for "New pattern." */
  initial?: SchedulePatternInput;
  onClose: () => void;
  onConfirm: (input: SchedulePatternInput) => void;
}) {
  const [form, setForm] = useState<SchedulePatternInput>(
    initial ?? { productId: products[0]?.id ?? "", ...DEFAULTS },
  );

  useEffect(() => {
    if (!open) return;
    setForm(initial ?? { productId: products[0]?.id ?? "", ...DEFAULTS });
  }, [open, initial, products]);

  function toggleDay(d: DayOfWeek) {
    setForm((f) => ({
      ...f,
      daysOfWeek: f.daysOfWeek.includes(d) ? f.daysOfWeek.filter((x) => x !== d) : [...f.daysOfWeek, d],
    }));
  }

  const validRange = /^\d{4}-\d{2}-\d{2}$/.test(form.startDate) && /^\d{4}-\d{2}-\d{2}$/.test(form.endDate) && form.endDate >= form.startDate;
  const previewCount = validRange && form.daysOfWeek.length > 0 ? datesInRange(form.startDate, form.endDate, form.daysOfWeek).length : null;

  const canSave = form.productId && form.daysOfWeek.length > 0 && validRange && form.capacity >= 1;

  const endBeforeStart = !!form.startDate && !!form.endDate && form.endDate < form.startDate;

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={initial ? "Change pattern" : "New schedule pattern"}
      wide
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant="key" className="px-6" disabled={busy || !canSave} onClick={() => onConfirm(form)}>
            Save schedule
          </Button>
        </>
      }
    >
      <div>
        <Label htmlFor="sched-trip-type">Trip type</Label>
        <Select
          id="sched-trip-type"
          value={form.productId}
          onChange={(e) => setForm((f) => ({ ...f, productId: e.target.value }))}
        >
          {products.map((p) => (
            <option key={p.id} value={p.id}>
              {p.displayName} · {p.vessel.name}
            </option>
          ))}
        </Select>
      </div>

      <fieldset className="border-0 m-0 p-0">
        <legend className="text-body-sm font-bold mb-1.5 p-0">Days</legend>
        <div className="grid grid-cols-7 gap-1.5">
          {VALID_DAYS.map((d) => {
            const on = form.daysOfWeek.includes(d);
            return (
              <button
                key={d}
                type="button"
                aria-pressed={on}
                onClick={() => toggleDay(d)}
                className={`min-h-field text-body font-extrabold border-2 rounded-ob ${
                  on ? "bg-ob-key text-ob-key-ink border-ob-key" : "bg-transparent text-ob-ink-2 border-ob-control hover:bg-ob-panel-2"
                }`}
              >
                <span aria-hidden="true">{DAY_LABELS[d]}</span>
                <span className="sr-only">{DAY_NAMES[d]}</span>
              </button>
            );
          })}
        </div>
      </fieldset>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label htmlFor="sched-leaves">Leaves</Label>
          <Input
            id="sched-leaves"
            type="time"
            value={form.departureTime}
            onChange={(e) => setForm((f) => ({ ...f, departureTime: e.target.value }))}
          />
        </div>
        <div>
          <Label htmlFor="sched-back">Back</Label>
          <Input
            id="sched-back"
            type="time"
            value={form.returnTime}
            onChange={(e) => setForm((f) => ({ ...f, returnTime: e.target.value }))}
          />
        </div>
      </div>

      <div>
        <Label htmlFor="sched-seats">Seats</Label>
        <Input
          id="sched-seats"
          type="number"
          inputMode="numeric"
          min={1}
          value={form.capacity}
          className="max-w-[200px]"
          onChange={(e) => setForm((f) => ({ ...f, capacity: Number(e.target.value) }))}
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label htmlFor="sched-start">Starting</Label>
          <Input
            id="sched-start"
            type="date"
            className="font-num"
            value={form.startDate}
            onChange={(e) => setForm((f) => ({ ...f, startDate: e.target.value }))}
          />
        </div>
        <div>
          <Label htmlFor="sched-end">Until</Label>
          <Input
            id="sched-end"
            type="date"
            className="font-num"
            invalid={endBeforeStart}
            aria-describedby={endBeforeStart ? "sched-end-error" : undefined}
            value={form.endDate}
            onChange={(e) => setForm((f) => ({ ...f, endDate: e.target.value }))}
          />
        </div>
      </div>
      {endBeforeStart && <FieldError id="sched-end-error">Until has to be on or after Starting.</FieldError>}

      <div role="status" className="flex items-center gap-3 px-4 py-3.5 bg-ob-panel-2 border-2 border-ob-rule">
        <span className="font-num text-num-time">{previewCount === null ? "—" : previewCount}</span>
        <span className="text-body-sm text-ob-ink-2 [text-wrap:pretty]">
          {previewCount === null
            ? "Pick days and a date range to see how many trips this creates."
            : `trip${previewCount === 1 ? "" : "s"} go on the calendar between those dates.`}
        </span>
      </div>
    </Dialog>
  );
}
