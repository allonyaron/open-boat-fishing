"use client";

import { useEffect, useState } from "react";
import { Dialog } from "./Dialog";
import { Button } from "./Button";
import { Input, Label } from "./Input";

export type BoatInput = {
  name: string;
  description: string;
  color: string;
  capacity: number;
  certificateCapacity: number | null;
  groupDiscountThreshold: number | null;
  groupDiscountPct: number | null;
};

const SWATCHES = ["#1D4ED8", "#0891B2", "#0c5132", "#8e1f0b", "#5e4200", "#303030"];

const DEFAULTS: BoatInput = {
  name: "",
  description: "",
  color: SWATCHES[0],
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
          <Button variant="primary" disabled={busy || !canSave} onClick={() => onConfirm(form)}>
            {isEdit ? "Save boat" : "Add boat"}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
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
        <div>
          <div className="text-13 text-merchant-ink mb-1.5">Color</div>
          <div className="flex gap-2">
            {SWATCHES.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setForm((f) => ({ ...f, color: c }))}
                aria-label={c}
                className="w-[38px] h-[38px] rounded-full"
                style={{
                  backgroundColor: c,
                  boxShadow: form.color === c ? "0 0 0 2px #303030" : undefined,
                }}
              />
            ))}
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label htmlFor="boat-capacity">Seats you sell</Label>
            <Input
              id="boat-capacity"
              type="number"
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
              min={1}
              value={form.certificateCapacity ?? ""}
              placeholder="Optional"
              onChange={(e) =>
                setForm((f) => ({ ...f, certificateCapacity: e.target.value ? Number(e.target.value) : null }))
              }
            />
          </div>
        </div>
        <div>
          <div className="text-13 text-merchant-ink mb-1.5">Group discount</div>
          <div className="grid grid-cols-2 gap-3">
            <Input
              type="number"
              min={1}
              aria-label="Group discount threshold"
              placeholder="Tickets (e.g. 6)"
              value={form.groupDiscountThreshold ?? ""}
              onChange={(e) =>
                setForm((f) => ({ ...f, groupDiscountThreshold: e.target.value ? Number(e.target.value) : null }))
              }
            />
            <Input
              type="number"
              min={1}
              max={100}
              aria-label="Group discount percent"
              placeholder="% off (e.g. 10)"
              value={form.groupDiscountPct ?? ""}
              onChange={(e) =>
                setForm((f) => ({ ...f, groupDiscountPct: e.target.value ? Number(e.target.value) : null }))
              }
            />
          </div>
          <p className="mt-1 text-12 text-merchant-faint">
            Leave both blank to disable the group discount for this boat.
          </p>
        </div>
      </div>
    </Dialog>
  );
}
