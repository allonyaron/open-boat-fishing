"use client";

import { useEffect, useState, useCallback } from "react";
import { ClearDemoCustomers } from "@/components/admin/ClearDemoCustomers";
import {
  Panel,
  Button,
  Input,
  HelpText,
  Lamp,
  BoatSwatch,
  useDensity,
  useToast,
  fmtMoney,
  ErrorState,
  LoadingState,
  PlusIcon,
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
  onlineCutoffMinutes: number;
  termsUrl: string | null;
  dockMapsUrl: string | null;
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
  // Editing a trip type whose boat is turned off: keep that boat in the (locked)
  // list so the select shows the real boat instead of falling back to the first.
  const tripTypeVesselOptions =
    tripTypeDialog && tripTypeDialog !== "new" && !vesselOptions.some((v) => v.id === tripTypeDialog.vesselId)
      ? [{ id: tripTypeDialog.vesselId, name: tripTypeDialog.vessel.name }, ...vesselOptions]
      : vesselOptions;

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
        showToast(body.error ?? "Couldn't save the boat.", "error");
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
        ...(isEdit ? { active: input.active } : {}),
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
        showToast(body.error ?? "Couldn't save the trip type.", "error");
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
        showToast(body.error ?? "Couldn't save this person.", "error");
        return;
      }
      showToast(isEdit ? "Person updated." : "Person added.");
      setPersonDialog(null);
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function saveOperatorField(field: keyof Operator, value: string | number | null): Promise<boolean> {
    const res = await fetch("/api/admin/settings/operator", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ [field]: value }),
    });
    if (!res.ok) {
      showToast("Couldn't save that change.", "error");
      return false;
    }
    setOperator((prev) => (prev ? { ...prev, [field]: value } : prev));
    return true;
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
          active: boatDialog.active,
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
          active: tripTypeDialog.active,
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

  const jumps: [string, string][] = [
    ["Boats", "#set-boats"],
    ["Trips you sell", "#set-trips"],
    ["People", "#set-people"],
    ["Business", "#set-biz"],
  ];

  return (
    <div className="flex flex-col gap-6 max-w-[1040px]">
      <div>
        <h1 className="text-title-page">Settings</h1>
        <nav aria-label="Settings sections" className="flex flex-wrap gap-2 mt-3.5">
          {jumps.map(([label, href]) => (
            <a
              key={href}
              href={href}
              className="inline-flex items-center min-h-tap-dock px-3.5 border-2 border-ob-rule rounded-ob text-body-sm font-bold text-ob-ink no-underline whitespace-nowrap hover:bg-ob-panel-2"
            >
              {label}
            </a>
          ))}
        </nav>
      </div>

      {error ? (
        <ErrorState onRetry={load} body={<>Settings just can&rsquo;t load right now.</>} />
      ) : (
        <>
          <Panel id="set-boats" aria-labelledby="sb-h" className="scroll-mt-20">
            <SectionHead id="sb-h" title="Your boats">
              <Button variant="strong" icon={<PlusIcon size={16} />} className="max-md:w-full" onClick={() => setBoatDialog("new")}>
                Add a boat
              </Button>
            </SectionHead>
            {!vessels ? (
              <LoadingState rows={2} />
            ) : (
              vessels.map((v) => (
                <Row key={v.id}>
                  <span
                    aria-hidden="true"
                    className="w-1.5 self-stretch min-h-10 flex-none shadow-[0_0_0_1px_var(--ob-control)]"
                    style={{ backgroundColor: v.color }}
                  />
                  <div className="flex-[1_1_300px] min-w-0">
                    <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                      <span className={`text-title-row ${v.active ? "" : "text-ob-ink-2"}`}>{v.name}</span>
                      {v.description && <span className="text-body-sm text-ob-ink-2">{v.description}</span>}
                      {!v.active && <TurnedOff />}
                    </div>
                    <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-body-sm text-ob-ink-2 mt-0.5">
                      <span>
                        Seats you sell: <span className="font-num text-ob-ink">{v.capacity}</span>
                      </span>
                      {v.certificateCapacity ? (
                        <span>
                          Coast Guard limit: <span className="font-num text-ob-ink">{v.certificateCapacity}</span>
                        </span>
                      ) : null}
                      {v.groupDiscountThreshold && v.groupDiscountPct ? (
                        <span>
                          Group discount: {v.groupDiscountThreshold}+ tickets, {v.groupDiscountPct}% off
                        </span>
                      ) : null}
                    </div>
                  </div>
                  <Button variant="secondary" className="max-md:w-full" onClick={() => setBoatDialog(v)}>
                    Change
                  </Button>
                </Row>
              ))
            )}
          </Panel>

          <Panel id="set-trips" aria-labelledby="st-h" className="scroll-mt-20">
            <SectionHead id="st-h" title="Trips you sell">
              <div className="flex flex-col items-end gap-1 max-md:w-full max-md:items-stretch">
                <Button
                  variant="strong"
                  icon={<PlusIcon size={16} />}
                  onClick={() => setTripTypeDialog("new")}
                  disabled={activeVessels.length === 0}
                  aria-describedby={activeVessels.length === 0 ? "add-boat-first" : undefined}
                >
                  Add a trip type
                </Button>
                {vessels && activeVessels.length === 0 && (
                  <span id="add-boat-first" className="text-meta text-ob-ink-3">
                    Add a boat first.
                  </span>
                )}
              </div>
            </SectionHead>
            {!products ? (
              <LoadingState rows={2} />
            ) : products.length === 0 ? (
              <div className="px-5 py-4 text-body text-ob-ink-2">No trip types yet.</div>
            ) : (
              <TripTypes products={products} onChange={setTripTypeDialog} />
            )}
          </Panel>

          <Panel id="set-people" aria-labelledby="sp-h" className="scroll-mt-20">
            <SectionHead id="sp-h" title="Your people">
              <Button variant="strong" icon={<PlusIcon size={16} />} className="max-md:w-full" onClick={() => setPersonDialog("new")}>
                Add someone
              </Button>
            </SectionHead>
            {!staff ? (
              <LoadingState rows={2} />
            ) : (
              staff.map((p) => {
                const vesselName = p.vesselId ? vessels?.find((v) => v.id === p.vesselId)?.name : null;
                return (
                  <Row key={p.id}>
                    <div className="flex-[1_1_240px] min-w-0">
                      <div className={`text-title-row ${p.active ? "" : "text-ob-ink-2"}`}>{p.name}</div>
                      <div className="text-body-sm text-ob-ink-2">
                        {p.role === "admin"
                          ? "Signs in with a password"
                          : `Signs in with a PIN${vesselName ? ` · ${vesselName}` : ""}`}
                      </div>
                    </div>
                    <span
                      className={`inline-flex items-center min-h-[30px] px-2.5 border-2 rounded-ob text-meta font-extrabold ${
                        p.role === "admin" ? "border-ob-ink" : "border-ob-control"
                      }`}
                    >
                      {p.role === "admin" ? "Admin" : "Mate"}
                    </span>
                    <span className="inline-flex items-center gap-2 min-w-[110px]">
                      {p.active ? (
                        <>
                          <Lamp tone="go" size={10} />
                          <span className="text-body-sm font-bold text-ob-go-ink">Active</span>
                        </>
                      ) : (
                        <TurnedOff />
                      )}
                    </span>
                    <Button variant="secondary" className="max-md:w-full" onClick={() => setPersonDialog(p)}>
                      Change
                    </Button>
                  </Row>
                );
              })
            )}
          </Panel>

          {operator ? <BusinessCard operator={operator} onSaveField={saveOperatorField} /> : <Panel><LoadingState rows={2} /></Panel>}

          {demoMode && <ClearDemoCustomers />}
        </>
      )}

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
        vessels={tripTypeVesselOptions}
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

function SectionHead({ id, title, children }: { id: string; title: string; children?: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-3.5 border-b-2 border-ob-rule max-md:px-4">
      <h2 id={id} className="text-title-panel">
        {title}
      </h2>
      {children}
    </div>
  );
}

function Row({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-3 px-5 py-4 border-t border-ob-hair [&:nth-child(2)]:border-t-0 max-md:px-4">
      {children}
    </div>
  );
}

/** Turned-off boats, trip types and people: a hollow light and the words, not dimmed opacity. */
function TurnedOff() {
  return (
    <span className="inline-flex items-center gap-1.5 text-meta font-bold text-ob-ink-2">
      <Lamp tone="ink-2" shape="hollow" size={10} />
      Turned off
    </span>
  );
}

function TripTypes({ products, onChange }: { products: Product[]; onChange: (p: Product) => void }) {
  const { density } = useDensity();
  const cellY = density === "dock" ? "py-3" : "py-1.5";
  const th = "py-2.5 px-3 text-meta font-bold text-ob-ink-2 whitespace-nowrap";
  return (
    <>
      <table className="w-full border-collapse text-body-sm max-md:hidden">
        <thead>
          <tr className="bg-ob-panel-2 text-left">
            <th scope="col" className={`${th} pl-5`}>Trip</th>
            <th scope="col" className={th}>Fish</th>
            <th scope="col" className={th}>Boat</th>
            <th scope="col" className={`${th} text-right`}>Adult</th>
            <th scope="col" className={`${th} text-right`}>Child</th>
            <th scope="col" className={`${th} text-right`}>Senior</th>
            <th scope="col" className={th}>Seats shown?</th>
            <th scope="col" className={`${th} pr-5`}>
              <span className="sr-only">Change</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {products.map((p) => (
            <tr key={p.id} className={`border-t border-ob-hair ${p.active ? "" : "text-ob-ink-2"}`}>
              <td className={`${cellY} pl-5 pr-3 font-bold`}>
                {p.displayName}
                {!p.active && (
                  <div className="font-normal">
                    <TurnedOff />
                  </div>
                )}
              </td>
              <td className={`${cellY} px-3`}>{p.category}</td>
              <td className={`${cellY} px-3 whitespace-nowrap`}>
                <span className="inline-flex items-center gap-2">
                  <BoatSwatch color={p.vessel.color} size="sm" />
                  {p.vessel.name}
                </span>
              </td>
              <td className={`${cellY} px-3 font-num text-right`}>{fmtMoney(priceOf(p, "adult"))}</td>
              <td className={`${cellY} px-3 font-num text-right`}>{fmtMoney(priceOf(p, "child"))}</td>
              <td className={`${cellY} px-3 font-num text-right`}>{fmtMoney(priceOf(p, "senior"))}</td>
              <td className={`${cellY} px-3`}>{p.showRemaining ? "Yes" : "No"}</td>
              <td className={`${cellY} pl-3 pr-5 text-right`}>
                <Button variant="secondary" onClick={() => onChange(p)} aria-label={`Change ${p.displayName}`}>
                  Change
                </Button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div role="list" className="md:hidden">
        {products.map((p) => (
          <div role="listitem" key={p.id} className="flex flex-col gap-2 px-4 py-3.5 border-t border-ob-hair first:border-t-0">
            <div className="flex items-baseline justify-between gap-3">
              <span className={`text-17 font-bold ${p.active ? "" : "text-ob-ink-2"}`}>{p.displayName}</span>
              <span className="text-body-sm text-ob-ink-2">{p.category}</span>
            </div>
            <div className="flex flex-wrap items-center gap-2 text-body-sm text-ob-ink-2">
              <BoatSwatch color={p.vessel.color} size="sm" />
              {p.vessel.name} · Seats shown: {p.showRemaining ? "Yes" : "No"}
              {!p.active && <TurnedOff />}
            </div>
            <div className="grid grid-cols-[repeat(3,1fr)_auto] gap-2 items-end">
              {(["adult", "child", "senior"] as const).map((t) => (
                <div key={t}>
                  <div className="text-meta text-ob-ink-3 capitalize">{t}</div>
                  <div className="font-num text-17">{fmtMoney(priceOf(p, t))}</div>
                </div>
              ))}
              <Button variant="secondary" onClick={() => onChange(p)} aria-label={`Change ${p.displayName}`}>
                Change
              </Button>
            </div>
          </div>
        ))}
      </div>
    </>
  );
}

function BusinessCard({
  operator,
  onSaveField,
}: {
  operator: Operator;
  onSaveField: (field: keyof Operator, value: string | number | null) => Promise<boolean>;
}) {
  return (
    <Panel id="set-biz" aria-labelledby="sz-h" className="scroll-mt-20">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 px-5 py-3.5 border-b-2 border-ob-rule max-md:px-4">
        <h2 id="sz-h" className="text-title-panel">
          Your business
        </h2>
        <span className="text-body-sm text-ob-ink-2">Changes save as you make them.</span>
      </div>
      <div className="grid grid-cols-2 max-md:grid-cols-1 gap-x-5 gap-y-[18px] p-5 max-md:px-4">
        <AutoSaveField label="Business name" field="name" value={operator.name} onSave={onSaveField} />
        <AutoSaveField label="Phone" field="phone" value={operator.phone ?? ""} onSave={onSaveField} />
        <AutoSaveField label="Booking email" field="emailFrom" value={operator.emailFrom} onSave={onSaveField} />
        <AutoSaveField label="Dock address" field="dockAddress" value={operator.dockAddress ?? ""} onSave={onSaveField} />
        <AutoSaveField
          label="Dock Google Maps link"
          field="dockMapsUrl"
          type="url"
          value={operator.dockMapsUrl ?? ""}
          placeholder="https://maps.google.com/…"
          help="Customers get it as “Get directions” on their booking and boarding pass."
          onSave={onSaveField}
        />
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
        <AutoSaveField
          label="Stop online sales (minutes before departure)"
          field="onlineCutoffMinutes"
          type="number"
          value={operator.onlineCutoffMinutes}
          help="Applies to every trip unless the trip sets its own. 0 = sell until departure."
          onSave={onSaveField}
        />
        <AutoSaveField
          label="Refund & cancellation policy link"
          field="termsUrl"
          value={operator.termsUrl ?? ""}
          placeholder="https://…"
          help="Shown to customers on their boarding pass."
          wide
          onSave={onSaveField}
        />
      </div>
    </Panel>
  );
}

function AutoSaveField({
  label,
  field,
  value,
  type = "text",
  placeholder,
  help,
  wide = false,
  onSave,
}: {
  label: string;
  field: keyof Operator;
  value: string | number;
  type?: string;
  placeholder?: string;
  help?: string;
  /** Span both columns. */
  wide?: boolean;
  onSave: (field: keyof Operator, value: string | number | null) => Promise<boolean>;
}) {
  const [local, setLocal] = useState(String(value));
  const [saved, setSaved] = useState(false);

  useEffect(() => setLocal(String(value)), [value]);

  async function commit() {
    if (local === String(value)) return;
    const out: string | number | null =
      type === "number" ? (local === "" ? null : Number(local)) : local === "" ? null : local;
    if (!(await onSave(field, out))) {
      setLocal(String(value)); // rejected: show the value that's still saved
      return;
    }
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  }

  const id = `biz-${field}`;
  return (
    <div className={`min-w-0 ${wide ? "col-span-2 max-md:col-span-1" : ""}`}>
      <div className="flex items-baseline justify-between gap-2 mb-1.5">
        <label htmlFor={id} className="text-body-sm font-bold">
          {label}
        </label>
        <span role="status" className="inline-flex items-center gap-1.5 text-meta font-bold text-ob-go-ink">
          {saved && (
            <>
              <Lamp tone="go" size={8} />
              Saved
            </>
          )}
        </span>
      </div>
      <Input
        id={id}
        type={type}
        inputMode={type === "number" ? "numeric" : undefined}
        value={local}
        placeholder={placeholder}
        aria-describedby={help ? `${id}-help` : undefined}
        onChange={(e) => setLocal(e.target.value)}
        onBlur={commit}
      />
      {help && <HelpText id={`${id}-help`}>{help}</HelpText>}
    </div>
  );
}
