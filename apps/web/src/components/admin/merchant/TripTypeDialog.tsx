"use client";

import { useEffect, useState } from "react";
import { Dialog } from "./Dialog";
import { Button } from "./Button";
import { Input, Label, Select, Toggle } from "./Input";

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
          <Button variant="primary" disabled={busy || !canSave} onClick={() => onConfirm(form)}>
            {isEdit ? "Save trip type" : "Add trip type"}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <div className="grid grid-cols-2 gap-3">
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
            onChange={(e) => setForm((f) => ({ ...f, vesselId: e.target.value }))}
            className={isEdit ? "bg-merchant-fill text-merchant-faint" : ""}
          >
            {vessels.map((v) => (
              <option key={v.id} value={v.id}>
                {v.name}
              </option>
            ))}
          </Select>
          {isEdit && <p className="mt-1 text-12 text-merchant-faint">The boat can&rsquo;t be changed after the trip type is created.</p>}
        </div>
        <div>
          <div className="text-13 text-merchant-ink mb-1.5">Prices</div>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <Label htmlFor="tt-adult">Adult</Label>
              <Input
                id="tt-adult"
                type="number"
                min={0}
                step="0.01"
                value={dollarsToInput(form.adultPriceCents)}
                onChange={(e) => setForm((f) => ({ ...f, adultPriceCents: inputToCents(e.target.value) }))}
              />
            </div>
            <div>
              <Label htmlFor="tt-child">Child</Label>
              <Input
                id="tt-child"
                type="number"
                min={0}
                step="0.01"
                value={dollarsToInput(form.childPriceCents)}
                onChange={(e) => setForm((f) => ({ ...f, childPriceCents: inputToCents(e.target.value) }))}
              />
            </div>
            <div>
              <Label htmlFor="tt-senior">Senior</Label>
              <Input
                id="tt-senior"
                type="number"
                min={0}
                step="0.01"
                value={dollarsToInput(form.seniorPriceCents)}
                onChange={(e) => setForm((f) => ({ ...f, seniorPriceCents: inputToCents(e.target.value) }))}
              />
            </div>
          </div>
        </div>
        <div>
          <Label htmlFor="tt-bring">What to bring</Label>
          <Input
            id="tt-bring"
            value={form.whatToBring}
            onChange={(e) => setForm((f) => ({ ...f, whatToBring: e.target.value }))}
            placeholder="Polarized sunglasses, motion sickness meds, cash for the mate"
          />
          <p className="mt-1 text-12 text-merchant-faint">Comma-separated.</p>
        </div>
        <div className="flex items-center justify-between">
          <div>
            <div className="text-13 text-merchant-ink">Show seats left on the website</div>
          </div>
          <Toggle
            checked={form.showRemaining}
            onChange={(v) => setForm((f) => ({ ...f, showRemaining: v }))}
            label="Show seats left"
          />
        </div>
      </div>
    </Dialog>
  );
}
