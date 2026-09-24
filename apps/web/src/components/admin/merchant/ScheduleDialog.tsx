"use client";

import { useEffect, useState } from "react";
import { Dialog } from "./Dialog";
import { Button } from "./Button";
import { Input, Label, Select } from "./Input";
import { datesInRange, VALID_DAYS, type DayOfWeek } from "@/lib/trip-materialization";
import type { ProductOption } from "./TripDialogs";

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

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Weekly schedule"
      wide
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant="primary" disabled={busy || !canSave} onClick={() => onConfirm(form)}>
            Save schedule
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
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

        <div>
          <div className="text-13 text-merchant-ink mb-1">Days</div>
          <div className="flex gap-1.5">
            {VALID_DAYS.map((d) => {
              const on = form.daysOfWeek.includes(d);
              return (
                <button
                  key={d}
                  type="button"
                  onClick={() => toggleDay(d)}
                  className={`w-[46px] h-[46px] rounded-lg text-13 font-semibold transition-colors ${
                    on ? "bg-merchant-chrome-mid text-white" : "bg-merchant-fill-3 text-merchant-faint"
                  }`}
                >
                  {DAY_LABELS[d]}
                </button>
              );
            })}
          </div>
        </div>

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
            min={1}
            value={form.capacity}
            onChange={(e) => setForm((f) => ({ ...f, capacity: Number(e.target.value) }))}
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label htmlFor="sched-start">Starting</Label>
            <Input
              id="sched-start"
              type="date"
              value={form.startDate}
              onChange={(e) => setForm((f) => ({ ...f, startDate: e.target.value }))}
            />
          </div>
          <div>
            <Label htmlFor="sched-end">Until</Label>
            <Input
              id="sched-end"
              type="date"
              value={form.endDate}
              onChange={(e) => setForm((f) => ({ ...f, endDate: e.target.value }))}
            />
          </div>
        </div>

        <div className="rounded-lg bg-merchant-blue-tint text-merchant-blue-deep text-13 px-3 py-2.5">
          {previewCount === null
            ? "Pick days and a date range to see how many trips this creates."
            : `This puts ${previewCount} trip${previewCount === 1 ? "" : "s"} on the calendar between those dates.`}
        </div>
      </div>
    </Dialog>
  );
}
