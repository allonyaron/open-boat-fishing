"use client";

import { useEffect, useState } from "react";
import { Dialog } from "./Dialog";
import { Button } from "./Button";
import { HelpText, Input, Label } from "./Input";
import { ActiveSwitch } from "./Controls";
import { CheckIcon } from "./icons";

export type BoatInput = {
  name: string;
  description: string;
  color: string;
  capacity: number;
  certificateCapacity: number | null;
  groupDiscountThreshold: number | null;
  groupDiscountPct: number | null;
  /** Edit only: false = turned off (left out of the admin's boat choices; nothing else changes). */
  active?: boolean;
};

// The colours a boat can be saved with — also used on the public booking site,
// so these are data values, not theme tokens. Names are for screen readers.
const SWATCHES: { hex: string; name: string }[] = [
  { hex: "#1D4ED8", name: "Blue" },
  { hex: "#0891B2", name: "Teal" },
  { hex: "#0c5132", name: "Green" },
  { hex: "#8e1f0b", name: "Red" },
  { hex: "#5e4200", name: "Brown" },
  { hex: "#303030", name: "Charcoal" },
];

const DEFAULTS: BoatInput = {
  name: "",
  description: "",
  color: SWATCHES[0].hex,
  capacity: 20,
  certificateCapacity: null,
  groupDiscountThreshold: null,
  groupDiscountPct: null,
};

export function BoatDialog({
  open,
  busy,
  initial,
  onClose,
  onConfirm,
}: {
  open: boolean;
  busy: boolean;
  /** Pre-fill for "Change" on an existing boat; omit for "Add a boat." */
  initial?: BoatInput;
  onClose: () => void;
  onConfirm: (input: BoatInput) => void;
}) {
  const [form, setForm] = useState<BoatInput>(initial ?? DEFAULTS);

  useEffect(() => {
    if (open) setForm(initial ?? DEFAULTS);
  }, [open, initial]);

  const isEdit = !!initial;
  const canSave = form.name.trim().length > 0 && form.capacity >= 1;

  // A boat saved with a colour outside the palette keeps it as an extra choice.
  const swatches =
    initial && !SWATCHES.some((w) => w.hex.toLowerCase() === initial.color.toLowerCase())
      ? [{ hex: initial.color, name: "Current colour" }, ...SWATCHES]
      : SWATCHES;

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={isEdit ? "Boat" : "Add a boat"}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant="key" className="px-6" disabled={busy || !canSave} onClick={() => onConfirm(form)}>
            {isEdit ? "Save boat" : "Add boat"}
          </Button>
        </>
      }
    >
      <div>
        <Label htmlFor="boat-name">Name</Label>
        <Input
          id="boat-name"
          value={form.name}
          onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
          placeholder="Miss Montauk"
        />
      </div>
      <div>
        <Label htmlFor="boat-description">Description</Label>
        <Input
          id="boat-description"
          value={form.description}
          onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
        />
      </div>
      <fieldset className="border-0 m-0 p-0">
        <legend className="text-body-sm font-bold mb-1.5 p-0">Color</legend>
        <div className="flex flex-wrap gap-2">
          {swatches.map((w) => {
            const on = form.color.toLowerCase() === w.hex.toLowerCase();
            return (
              <button
                key={w.hex}
                type="button"
                aria-pressed={on}
                onClick={() => setForm((f) => ({ ...f, color: w.hex }))}
                className={`flex items-center justify-center w-12 h-12 rounded-ob text-white border-2 ${
                  on ? "border-ob-ink shadow-[0_0_0_2px_var(--ob-panel),0_0_0_4px_var(--ob-ink)]" : "border-ob-control"
                }`}
                style={{ backgroundColor: w.hex }}
              >
                {on && <CheckIcon size={22} />}
                <span className="sr-only">{w.name}</span>
              </button>
            );
          })}
        </div>
      </fieldset>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label htmlFor="boat-capacity">Seats you sell</Label>
          <Input
            id="boat-capacity"
            type="number"
            inputMode="numeric"
            min={1}
            value={form.capacity}
            onChange={(e) => setForm((f) => ({ ...f, capacity: Number(e.target.value) }))}
          />
        </div>
        <div>
          <Label htmlFor="boat-cert">Coast Guard limit</Label>
          <Input
            id="boat-cert"
            type="number"
            inputMode="numeric"
            min={1}
            value={form.certificateCapacity ?? ""}
            placeholder="Optional"
            onChange={(e) =>
              setForm((f) => ({ ...f, certificateCapacity: e.target.value ? Number(e.target.value) : null }))
            }
          />
        </div>
      </div>
      <fieldset className="border-0 m-0 p-0">
        <legend className="text-body-sm font-bold mb-1.5 p-0">Group discount</legend>
        <div className="grid grid-cols-2 gap-3">
          <Input
            type="number"
            inputMode="numeric"
            min={1}
            numeric={false}
            aria-label="Group discount threshold"
            placeholder="Tickets (e.g. 6)"
            value={form.groupDiscountThreshold ?? ""}
            onChange={(e) =>
              setForm((f) => ({ ...f, groupDiscountThreshold: e.target.value ? Number(e.target.value) : null }))
            }
          />
          <Input
            type="number"
            inputMode="numeric"
            min={1}
            max={100}
            numeric={false}
            aria-label="Group discount percent"
            placeholder="% off (e.g. 10)"
            value={form.groupDiscountPct ?? ""}
            onChange={(e) =>
              setForm((f) => ({ ...f, groupDiscountPct: e.target.value ? Number(e.target.value) : null }))
            }
          />
        </div>
        <HelpText>Leave both blank to disable the group discount for this boat.</HelpText>
      </fieldset>
      {isEdit && (
        <ActiveSwitch
          id="boat-active"
          checked={form.active ?? true}
          onChange={(v) => setForm((f) => ({ ...f, active: v }))}
          help="Turned off, this boat isn't offered when you add a trip type or pick someone's boat. Its trips, patterns and bookings don't change."
        />
      )}
    </Dialog>
  );
}
