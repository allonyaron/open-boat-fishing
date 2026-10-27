"use client";

import { useEffect, useState } from "react";
import { Dialog } from "./Dialog";
import { Button } from "./Button";
import { HelpText, Input, Label, Select } from "./Input";
import { ActiveSwitch, Segmented } from "./Controls";
import type { VesselOption } from "./TripTypeDialog";

export type PersonInput = {
  name: string;
  email: string;
  role: "admin" | "mate";
  vesselId: string | null;
  /** Password (admin) or PIN (mate). Blank on edit means "keep the one they have." */
  secret: string;
  active: boolean;
};

const DEFAULTS: PersonInput = { name: "", email: "", role: "mate", vesselId: null, secret: "", active: true };

export function PersonDialog({
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
  /** Pre-fill for "Change" on an existing person; omit for "Add someone." */
  initial?: PersonInput;
  onClose: () => void;
  onConfirm: (input: PersonInput) => void;
}) {
  const [form, setForm] = useState<PersonInput>(initial ?? DEFAULTS);

  useEffect(() => {
    if (open) setForm(initial ?? DEFAULTS);
  }, [open, initial]);

  const isEdit = !!initial;
  const secretLabel = form.role === "admin" ? "Password" : "PIN";
  const secretValid = isEdit
    ? form.secret === "" || (form.role === "admin" ? form.secret.length >= 8 : /^\d{4,8}$/.test(form.secret))
    : form.role === "admin"
      ? form.secret.length >= 8
      : /^\d{4,8}$/.test(form.secret);
  const canSave = form.name.trim().length > 0 && (isEdit || form.email.trim().includes("@")) && secretValid;

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={isEdit ? "Person" : "Add someone"}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant="key" className="px-6" disabled={busy || !canSave} onClick={() => onConfirm(form)}>
            {isEdit ? "Save person" : "Add person"}
          </Button>
        </>
      }
    >
      <div>
        <Label htmlFor="person-name">Name</Label>
        <Input id="person-name" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
      </div>
      <div>
        <Label htmlFor="person-email">Email</Label>
        <Input
          id="person-email"
          type="email"
          value={form.email}
          disabled={isEdit}
          aria-describedby={isEdit ? "person-email-help" : undefined}
          onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
        />
        {isEdit && <HelpText id="person-email-help">Email can&rsquo;t be changed after the account is created.</HelpText>}
      </div>

      <div>
        <div className="text-body-sm font-bold mb-1.5">Role</div>
        {isEdit ? (
          <div className="text-body font-bold capitalize">{form.role}</div>
        ) : (
          <Segmented
            label="Role"
            size="dock"
            fill
            value={form.role}
            onChange={(r) => setForm((f) => ({ ...f, role: r, vesselId: r === "admin" ? null : f.vesselId }))}
            options={[
              { value: "admin", label: "Admin" },
              { value: "mate", label: "Mate" },
            ]}
          />
        )}
      </div>

      {form.role === "mate" && (
        <div>
          <Label htmlFor="person-boat">Boat</Label>
          <Select
            id="person-boat"
            value={form.vesselId ?? ""}
            onChange={(e) => setForm((f) => ({ ...f, vesselId: e.target.value || null }))}
          >
            <option value="">Any boat</option>
            {vessels.map((v) => (
              <option key={v.id} value={v.id}>
                {v.name}
              </option>
            ))}
          </Select>
        </div>
      )}

      <div>
        <Label htmlFor="person-secret">{secretLabel}</Label>
        <Input
          id="person-secret"
          type={form.role === "admin" ? "password" : "text"}
          inputMode={form.role === "mate" ? "numeric" : undefined}
          numeric={form.role === "mate"}
          value={form.secret}
          onChange={(e) => setForm((f) => ({ ...f, secret: e.target.value }))}
          placeholder={
            isEdit
              ? "Leave this blank to keep the one they have"
              : form.role === "admin"
                ? "At least 8 characters"
                : "4–8 digits"
          }
        />
      </div>

      <ActiveSwitch id="person-active" checked={form.active} onChange={(v) => setForm((f) => ({ ...f, active: v }))} />
    </Dialog>
  );
}
