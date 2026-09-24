"use client";

import { useEffect, useState, useCallback } from "react";
import { dollars } from "@openboat/utils";
import { ClearDemoCustomers } from "@/components/admin/ClearDemoCustomers";
import {
  Card,
  CardHeader,
  CardRow,
  Button,
  TextButton,
  Input,
  Label,
  useToast,
  BoatDialog,
  TripTypeDialog,
  PersonDialog,
  type BoatInput,
  type TripTypeInput,
  type PersonInput,
} from "@/components/admin/merchant";

type Vessel = {
  id: string;
  name: string;
  description: string | null;
  color: string;
  capacity: number;
  certificateCapacity: number | null;
  groupDiscountThreshold: number | null;
  groupDiscountPct: number | null;
  active: boolean;
};

type Product = {
  id: string;
  vesselId: string;
  category: string;
  displayName: string;
  whatToBring: string[];
  showRemaining: boolean;
  active: boolean;
  vessel: { id: string; name: string; color: string };
  prices: { ticketType: "adult" | "child" | "senior"; priceCents: number }[];
};

type StaffMember = {
  id: string;
  name: string;
  email: string;
  role: "admin" | "mate";
  vesselId: string | null;
  active: boolean;
};

type Operator = {
  name: string;
  phone: string | null;
  emailFrom: string;
  dockAddress: string | null;
  arriveMinutesBefore: number | null;
  cancelWindowHrs: number;
  termsUrl: string | null;
};

type BoatDialogState = "new" | Vessel | null;
type TripTypeDialogState = "new" | Product | null;
type PersonDialogState = "new" | StaffMember | null;

function priceOf(product: Product, type: "adult" | "child" | "senior"): number {
  return product.prices.find((p) => p.ticketType === type)?.priceCents ?? 0;
}

export default function SettingsClient({ demoMode }: { demoMode: boolean }) {
  const { showToast } = useToast();

  const [vessels, setVessels] = useState<Vessel[] | null>(null);
  const [products, setProducts] = useState<Product[] | null>(null);
  const [staff, setStaff] = useState<StaffMember[] | null>(null);
  const [operator, setOperator] = useState<Operator | null>(null);
  const [error, setError] = useState(false);

  const [boatDialog, setBoatDialog] = useState<BoatDialogState>(null);
  const [tripTypeDialog, setTripTypeDialog] = useState<TripTypeDialogState>(null);
  const [personDialog, setPersonDialog] = useState<PersonDialogState>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setError(false);
    try {
      const [vRes, pRes, sRes, oRes] = await Promise.all([
        fetch("/api/admin/settings/vessels"),
        fetch("/api/admin/settings/products"),
        fetch("/api/admin/settings/staff"),
        fetch("/api/admin/settings/operator"),
      ]);
      if (!vRes.ok || !pRes.ok || !sRes.ok || !oRes.ok) throw new Error("failed");
      setVessels(await vRes.json());
      setProducts(await pRes.json());
      setStaff(await sRes.json());
      setOperator(await oRes.json());
    } catch {
      setError(true);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const activeVessels = (vessels ?? []).filter((v) => v.active);
  const vesselOptions = activeVessels.map((v) => ({ id: v.id, name: v.name }));

  async function submitBoat(input: BoatInput) {
    setBusy(true);
    try {
      const isEdit = boatDialog !== "new" && boatDialog !== null;
      const url = isEdit ? `/api/admin/settings/vessels/${boatDialog.id}` : "/api/admin/settings/vessels";
      const res = await fetch(url, {
        method: isEdit ? "PATCH" : "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(input),
      });
      const body = await res.json();
      if (!res.ok) {
        showToast(body.error ?? "Couldn't save the boat.");
        return;
      }
      showToast(isEdit ? "Boat updated." : "Boat added.");
      setBoatDialog(null);
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function submitTripType(input: TripTypeInput) {
    setBusy(true);
    try {
      const isEdit = tripTypeDialog !== "new" && tripTypeDialog !== null;
      const prices = [
        { ticketType: "adult", priceCents: input.adultPriceCents },
        { ticketType: "child", priceCents: input.childPriceCents },
        { ticketType: "senior", priceCents: input.seniorPriceCents },
      ];
      const payload = {
        vesselId: input.vesselId,
        displayName: input.displayName,
        category: input.category,
        whatToBring: input.whatToBring.split(",").map((s) => s.trim()).filter(Boolean),
        showRemaining: input.showRemaining,
        prices,
      };
      const url = isEdit
        ? `/api/admin/settings/products/${tripTypeDialog.id}`
        : "/api/admin/settings/products";
      const res = await fetch(url, {
        method: isEdit ? "PATCH" : "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = await res.json();
      if (!res.ok) {
        showToast(body.error ?? "Couldn't save the trip type.");
        return;
      }
      showToast(isEdit ? "Trip type updated." : "Trip type added.");
      setTripTypeDialog(null);
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function submitPerson(input: PersonInput) {
    setBusy(true);
    try {
      const isEdit = personDialog !== "new" && personDialog !== null;
      let payload: Record<string, unknown>;
      if (isEdit) {
        payload = { name: input.name, active: input.active };
        if (input.role === "mate") payload.vesselId = input.vesselId;
        if (input.secret) {
          if (input.role === "admin") payload.password = input.secret;
          else payload.pin = input.secret;
        }
      } else {
        payload = { name: input.name, email: input.email, role: input.role };
        if (input.role === "admin") payload.password = input.secret;
        else {
          payload.pin = input.secret;
          if (input.vesselId) payload.vesselId = input.vesselId;
        }
      }
      const url = isEdit ? `/api/admin/settings/staff/${personDialog.id}` : "/api/admin/settings/staff";
      const res = await fetch(url, {
        method: isEdit ? "PATCH" : "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = await res.json();
      if (!res.ok) {
        showToast(body.error ?? "Couldn't save this person.");
        return;
      }
      showToast(isEdit ? "Person updated." : "Person added.");
      setPersonDialog(null);
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function saveOperatorField(field: keyof Operator, value: string | number | null) {
    const res = await fetch("/api/admin/settings/operator", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ [field]: value }),
    });
    if (!res.ok) {
      showToast("Couldn't save that change.");
      return;
    }
    setOperator((prev) => (prev ? { ...prev, [field]: value } : prev));
  }

  if (error) {
    return (
      <div className="rounded-xl border border-merchant-red-tint bg-[#fff8f7] p-5">
        <div className="text-14 font-semibold text-merchant-red">Can&rsquo;t reach the booking system</div>
        <p className="mt-1 text-13 text-merchant-muted">Settings just can&rsquo;t load right now.</p>
        <Button variant="secondary" className="mt-3" onClick={load}>
          Try again
        </Button>
      </div>
    );
  }

  const boatDialogInitial: BoatInput | undefined =
    boatDialog && boatDialog !== "new"
      ? {
          name: boatDialog.name,
          description: boatDialog.description ?? "",
          color: boatDialog.color,
          capacity: boatDialog.capacity,
          certificateCapacity: boatDialog.certificateCapacity,
          groupDiscountThreshold: boatDialog.groupDiscountThreshold,
          groupDiscountPct: boatDialog.groupDiscountPct,
        }
      : undefined;

  const tripTypeDialogInitial: TripTypeInput | undefined =
    tripTypeDialog && tripTypeDialog !== "new"
      ? {
          displayName: tripTypeDialog.displayName,
          category: tripTypeDialog.category,
          vesselId: tripTypeDialog.vesselId,
          adultPriceCents: priceOf(tripTypeDialog, "adult"),
          childPriceCents: priceOf(tripTypeDialog, "child"),
          seniorPriceCents: priceOf(tripTypeDialog, "senior"),
          whatToBring: tripTypeDialog.whatToBring.join(", "),
          showRemaining: tripTypeDialog.showRemaining,
        }
      : undefined;

  const personDialogInitial: PersonInput | undefined =
    personDialog && personDialog !== "new"
      ? {
          name: personDialog.name,
          email: personDialog.email,
          role: personDialog.role,
          vesselId: personDialog.vesselId,
          secret: "",
          active: personDialog.active,
        }
      : undefined;

  return (
    <div className="flex flex-col gap-4 max-w-[900px]">
      <h1 className="text-20 font-bold text-merchant-ink" style={{ letterSpacing: "-0.01em" }}>
        Settings
      </h1>

      <Card>
        <CardHeader title="Your boats" />
        {!vessels ? (
          <CardRow className="text-13 text-merchant-muted">Loading…</CardRow>
        ) : (
          vessels.map((v) => (
            <CardRow key={v.id} className={`flex items-center gap-3 ${v.active ? "" : "opacity-55"}`}>
              <span className="w-1.5 h-10 rounded-full flex-shrink-0" style={{ backgroundColor: v.color }} />
              <div className="flex-1 min-w-0">
                <div className="text-14 font-semibold text-merchant-ink">
                  {v.name}
                  {v.description && <span className="font-normal text-merchant-muted"> — {v.description}</span>}
                </div>
                <div className="text-13 text-merchant-muted">
                  Seats you sell: {v.capacity}
                  {v.certificateCapacity && ` · Coast Guard limit: ${v.certificateCapacity}`}
                  {v.groupDiscountThreshold && v.groupDiscountPct
                    ? ` · Group discount: ${v.groupDiscountThreshold}+ tickets, ${v.groupDiscountPct}% off`
                    : ""}
                </div>
              </div>
              <TextButton onClick={() => setBoatDialog(v)} className="flex-shrink-0">
                Change
              </TextButton>
            </CardRow>
          ))
        )}
        <CardRow>
          <Button variant="secondary" onClick={() => setBoatDialog("new")}>
            Add a boat
          </Button>
        </CardRow>
      </Card>

      <Card>
        <CardHeader title="Trips you sell" />
        {!products ? (
          <CardRow className="text-13 text-merchant-muted">Loading…</CardRow>
        ) : products.length === 0 ? (
          <CardRow className="text-13 text-merchant-muted">No trip types yet.</CardRow>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-13">
              <thead>
                <tr className="bg-merchant-fill text-left">
                  {["Trip", "Fish", "Boat", "Adult", "Child", "Senior", "Seats shown?", ""].map((h) => (
                    <th key={h} className="px-4 py-2 text-12 font-semibold text-merchant-muted">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {products.map((p) => (
                  <tr key={p.id} className={`border-t border-merchant-hairline ${p.active ? "" : "opacity-55"}`}>
                    <td className="px-4 py-2.5 font-semibold text-merchant-ink whitespace-nowrap">{p.displayName}</td>
                    <td className="px-4 py-2.5 whitespace-nowrap">{p.category}</td>
                    <td className="px-4 py-2.5 whitespace-nowrap">
                      <span className="inline-flex items-center gap-1.5">
                        <span className="w-2 h-2 rounded-full inline-block" style={{ backgroundColor: p.vessel.color }} />
                        {p.vessel.name}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 tabular-nums">{dollars(priceOf(p, "adult"))}</td>
                    <td className="px-4 py-2.5 tabular-nums">{dollars(priceOf(p, "child"))}</td>
                    <td className="px-4 py-2.5 tabular-nums">{dollars(priceOf(p, "senior"))}</td>
                    <td className="px-4 py-2.5">{p.showRemaining ? "Yes" : "No"}</td>
                    <td className="px-4 py-2.5 whitespace-nowrap">
                      <TextButton onClick={() => setTripTypeDialog(p)}>Change</TextButton>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <CardRow>
          <Button variant="secondary" onClick={() => setTripTypeDialog("new")} disabled={activeVessels.length === 0}>
            Add a trip type
          </Button>
          {activeVessels.length === 0 && (
            <p className="mt-1.5 text-12 text-merchant-faint">Add a boat first.</p>
          )}
        </CardRow>
      </Card>

      <Card>
        <CardHeader title="Your people" />
        {!staff ? (
          <CardRow className="text-13 text-merchant-muted">Loading…</CardRow>
        ) : (
          staff.map((s) => {
            const vesselName = s.vesselId ? vessels?.find((v) => v.id === s.vesselId)?.name : null;
            return (
              <CardRow key={s.id} className={`flex items-center gap-3 ${s.active ? "" : "opacity-55"}`}>
                <div className="flex-1 min-w-0">
                  <div className="text-14 font-semibold text-merchant-ink">{s.name}</div>
                  <div className="text-13 text-merchant-muted">
                    {s.role === "admin" ? "Signs in with a password" : `Signs in with a PIN${vesselName ? ` · ${vesselName}` : ""}`}
                  </div>
                </div>
                <span
                  className="inline-flex items-center rounded-full px-2.5 py-0.5 text-12 font-semibold flex-shrink-0"
                  style={
                    s.role === "admin"
                      ? { backgroundColor: "#e0f0ff", color: "#00449e" }
                      : { backgroundColor: "#e3e3e3", color: "#4a4a4a" }
                  }
                >
                  {s.role === "admin" ? "Admin" : "Mate"}
                </span>
                <span className="text-13 text-merchant-muted flex-shrink-0">{s.active ? "Active" : "Turned off"}</span>
                <TextButton onClick={() => setPersonDialog(s)} className="flex-shrink-0">
                  Change
                </TextButton>
              </CardRow>
            );
          })
        )}
        <CardRow>
          <Button variant="secondary" onClick={() => setPersonDialog("new")}>
            Add someone
          </Button>
        </CardRow>
      </Card>

      {operator && <BusinessCard operator={operator} onSaveField={saveOperatorField} />}

      {demoMode && <ClearDemoCustomers />}

      <BoatDialog
        open={boatDialog !== null}
        busy={busy}
        initial={boatDialogInitial}
        onClose={() => setBoatDialog(null)}
        onConfirm={submitBoat}
      />
      <TripTypeDialog
        open={tripTypeDialog !== null}
        busy={busy}
        vessels={vesselOptions}
        initial={tripTypeDialogInitial}
        onClose={() => setTripTypeDialog(null)}
        onConfirm={submitTripType}
      />
      <PersonDialog
        open={personDialog !== null}
        busy={busy}
        vessels={vesselOptions}
        initial={personDialogInitial}
        onClose={() => setPersonDialog(null)}
        onConfirm={submitPerson}
      />
    </div>
  );
}

function BusinessCard({
  operator,
  onSaveField,
}: {
  operator: Operator;
  onSaveField: (field: keyof Operator, value: string | number | null) => Promise<void>;
}) {
  return (
    <Card>
      <CardHeader title="Your business" subtitle="Changes save as you make them." />
      <CardRow className="grid sm:grid-cols-2 gap-4">
        <AutoSaveField label="Business name" field="name" value={operator.name} onSave={onSaveField} />
        <AutoSaveField label="Phone" field="phone" value={operator.phone ?? ""} onSave={onSaveField} />
        <AutoSaveField label="Booking email" field="emailFrom" value={operator.emailFrom} onSave={onSaveField} />
        <AutoSaveField label="Dock address" field="dockAddress" value={operator.dockAddress ?? ""} onSave={onSaveField} />
        <AutoSaveField
          label="How early to arrive (minutes)"
          field="arriveMinutesBefore"
          type="number"
          value={operator.arriveMinutesBefore ?? ""}
          onSave={onSaveField}
        />
        <AutoSaveField
          label="Free-cancellation window (hours)"
          field="cancelWindowHrs"
          type="number"
          value={operator.cancelWindowHrs}
          onSave={onSaveField}
        />
        <div className="sm:col-span-2">
          <AutoSaveField
            label="Refund & cancellation policy link"
            field="termsUrl"
            value={operator.termsUrl ?? ""}
            placeholder="https://…"
            onSave={onSaveField}
          />
          <p className="mt-1 text-12 text-merchant-faint">Shown to customers on their boarding pass.</p>
        </div>
      </CardRow>
    </Card>
  );
}

function AutoSaveField({
  label,
  field,
  value,
  type = "text",
  placeholder,
  onSave,
}: {
  label: string;
  field: keyof Operator;
  value: string | number;
  type?: string;
  placeholder?: string;
  onSave: (field: keyof Operator, value: string | number | null) => Promise<void>;
}) {
  const [local, setLocal] = useState(String(value));
  const [saved, setSaved] = useState(false);

  useEffect(() => setLocal(String(value)), [value]);

  async function commit() {
    if (local === String(value)) return;
    const out: string | number | null =
      type === "number" ? (local === "" ? null : Number(local)) : local === "" ? null : local;
    await onSave(field, out);
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  }

  return (
    <div>
      <Label htmlFor={`biz-${field}`}>{label}</Label>
      <div className="relative">
        <Input
          id={`biz-${field}`}
          type={type}
          value={local}
          placeholder={placeholder}
          onChange={(e) => setLocal(e.target.value)}
          onBlur={commit}
        />
        {saved && <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-12 text-merchant-green">Saved</span>}
      </div>
    </div>
  );
}
