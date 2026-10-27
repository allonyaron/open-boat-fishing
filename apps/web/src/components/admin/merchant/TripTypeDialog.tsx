"use client";

import { useEffect, useState } from "react";
import { Dialog } from "./Dialog";
import { Button } from "./Button";
import { HelpText, Input, Label, Select } from "./Input";
import { ActiveSwitch, Switch } from "./Controls";

export type VesselOption = { id: string; name: string };

export type TripTypeInput = {
  displayName: string;
  category: string;
  vesselId: string;
  adultPriceCents: number;
  childPriceCents: number;
  seniorPriceCents: number;
  whatToBring: string; // comma-separated in the form, split on submit
  showRemaining: boolean;
  /** Edit only: false = turned off (left out of new schedule patterns; nothing else changes). */
  active?: boolean;
};

const DEFAULTS: Omit<TripTypeInput, "vesselId"> = {
  displayName: "",
  category: "",
  adultPriceCents: 0,
  childPriceCents: 0,
  seniorPriceCents: 0,
  whatToBring: "",
  showRemaining: false,
};

function dollarsToInput(cents: number): string {
  return (cents / 100).toFixed(2);
}
function inputToCents(v: string): number {
  const n = Math.round(Number(v) * 100);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

export function TripTypeDialog({
  open,
  busy,
  vessels,
  initial,
  onClose,
  onConfirm,
}: {
  open: boolean;
  busy: boolean;
  vessels: VesselOption[];
  /** Pre-fill for "Change" on an existing trip type; omit for "Add a trip type." */
  initial?: TripTypeInput;
  onClose: () => void;
  onConfirm: (input: TripTypeInput) => void;
}) {
  const [form, setForm] = useState<TripTypeInput>(initial ?? { vesselId: vessels[0]?.id ?? "", ...DEFAULTS });

  useEffect(() => {
    if (open) setForm(initial ?? { vesselId: vessels[0]?.id ?? "", ...DEFAULTS });
  }, [open, initial, vessels]);

  const isEdit = !!initial;
  const canSave = form.displayName.trim().length > 0 && form.category.trim().length > 0 && !!form.vesselId;

  const price = (id: string, label: string, key: "adultPriceCents" | "childPriceCents" | "seniorPriceCents") => (
    <div>
      <Label htmlFor={id}>{label}</Label>
      <div className="relative">
        <span aria-hidden="true" className="absolute left-3.5 top-1/2 -translate-y-1/2 font-num text-18 text-ob-ink-3">
          $
        </span>
        <Input
          id={id}
          type="number"
          inputMode="decimal"
          min={0}
          step="0.01"
          className="pl-8"
          value={dollarsToInput(form[key])}
          onChange={(e) => setForm((f) => ({ ...f, [key]: inputToCents(e.target.value) }))}
        />
      </div>
    </div>
  );

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={isEdit ? "Trip type" : "Add a trip type"}
      wide
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant="key" className="px-6" disabled={busy || !canSave} onClick={() => onConfirm(form)}>
            {isEdit ? "Save trip type" : "Add trip type"}
          </Button>
        </>
      }
    >
      <div className="grid grid-cols-2 gap-3 max-md:grid-cols-1">
        <div>
          <Label htmlFor="tt-name">Name</Label>
          <Input
            id="tt-name"
            value={form.displayName}
            onChange={(e) => setForm((f) => ({ ...f, displayName: e.target.value }))}
            placeholder="Half Day Fluke"
          />
        </div>
        <div>
          <Label htmlFor="tt-fish">Fish</Label>
          <Input
            id="tt-fish"
            value={form.category}
            onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))}
            placeholder="Fluke"
          />
        </div>
      </div>
      <div>
        <Label htmlFor="tt-boat">Boat</Label>
        <Select
          id="tt-boat"
          value={form.vesselId}
          disabled={isEdit}
          aria-describedby={isEdit ? "tt-boat-help" : undefined}
          onChange={(e) => setForm((f) => ({ ...f, vesselId: e.target.value }))}
        >
          {vessels.map((v) => (
            <option key={v.id} value={v.id}>
              {v.name}
            </option>
          ))}
        </Select>
        {isEdit && <HelpText id="tt-boat-help">The boat can&rsquo;t be changed after the trip type is created.</HelpText>}
      </div>
      <fieldset className="border-0 m-0 p-0">
        <legend className="text-body-sm font-bold mb-1.5 p-0">Prices</legend>
        <div className="grid grid-cols-3 gap-3">
          {price("tt-adult", "Adult", "adultPriceCents")}
          {price("tt-child", "Child", "childPriceCents")}
          {price("tt-senior", "Senior", "seniorPriceCents")}
        </div>
      </fieldset>
      <div>
        <Label htmlFor="tt-bring">What to bring</Label>
        <Input
          id="tt-bring"
          value={form.whatToBring}
          onChange={(e) => setForm((f) => ({ ...f, whatToBring: e.target.value }))}
          placeholder="Polarized sunglasses, motion sickness meds, cash for the mate"
        />
        <HelpText>Comma-separated.</HelpText>
      </div>
      <div className="flex items-center justify-between gap-4">
        <span id="tt-shown-label" className="text-body-sm font-bold">
          Show seats left on the website
        </span>
        <Switch
          checked={form.showRemaining}
          onChange={(v) => setForm((f) => ({ ...f, showRemaining: v }))}
          labelledBy="tt-shown-label"
        />
      </div>
      {isEdit && (
        <ActiveSwitch
          id="tt-active"
          checked={form.active ?? true}
          onChange={(v) => setForm((f) => ({ ...f, active: v }))}
          help="Turned off, this trip type isn't offered for new schedule patterns. Its trips and bookings don't change."
        />
      )}
    </Dialog>
  );
}
