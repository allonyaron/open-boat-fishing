"use client";

import { useEffect, useState } from "react";

type StaffMember = {
  id: string;
  name: string;
  email: string;
  role: "admin" | "mate";
  vesselId: string | null;
  active: boolean;
};
type Vessel = { id: string; name: string };

const inputCls = "w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500";

function StaffForm({
  vessels,
  onSave,
  onCancel,
}: {
  vessels: Vessel[];
  onSave: (data: Record<string, unknown>) => Promise<string | null>;
  onCancel: () => void;
}) {
  const [role, setRole] = useState<"admin" | "mate">("mate");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [pin, setPin] = useState("");
  const [vesselId, setVesselId] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError("");
    const data: Record<string, unknown> = { name, email, role };
    if (role === "admin") data.password = password;
    else { data.pin = pin; if (vesselId) data.vesselId = vesselId; }
    const err = await onSave(data);
    setSaving(false);
    if (err) setError(err);
  }

  return (
    <form onSubmit={submit} className="bg-gray-50 rounded-xl border border-gray-200 p-5 grid gap-4">
      <div>
        <div className="text-sm font-medium text-gray-700 mb-2">Role</div>
        <div className="flex gap-3">
          {(["admin", "mate"] as const).map((r) => (
            <label key={r} className="flex items-center gap-2 cursor-pointer">
              <input type="radio" value={r} checked={role === r} onChange={() => setRole(r)} />
              <span className="text-sm capitalize text-gray-700">{r}</span>
              <span className="text-xs text-gray-400">{r === "admin" ? "(password login, web dashboard)" : "(PIN login, tablet check-in)"}</span>
            </label>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Name</label>
          <input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} required placeholder="Captain John" />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
          <input className={inputCls} type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </div>
      </div>

      {role === "admin" ? (
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Password (min 8 chars)</label>
          <input className={inputCls} type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={8} />
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">PIN (4–8 digits)</label>
            <input
              className={inputCls}
              type="password"
              inputMode="numeric"
              pattern="\d{4,8}"
              value={pin}
              onChange={(e) => setPin(e.target.value)}
              required
              placeholder="e.g. 1234"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Assigned vessel (optional)</label>
            <select className={inputCls} value={vesselId} onChange={(e) => setVesselId(e.target.value)}>
              <option value="">— unassigned —</option>
              {vessels.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
            </select>
          </div>
        </div>
      )}

      {error && <p className="text-sm text-red-600">{error}</p>}

      <div className="flex gap-3 justify-end">
        <button type="button" onClick={onCancel} className="border border-gray-300 text-gray-700 px-4 py-2 rounded-lg text-sm hover:bg-gray-50">Cancel</button>
        <button type="submit" disabled={saving} className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50">
          {saving ? "Creating…" : "Create account"}
        </button>
      </div>
    </form>
  );
}

function StaffRow({
  member,
  vessels,
  currentStaffId,
  onRefresh,
}: {
  member: StaffMember;
  vessels: Vessel[];
  currentStaffId: string;
  onRefresh: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [newPin, setNewPin] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [vesselId, setVesselId] = useState(member.vesselId ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const isMe = member.id === currentStaffId;

  async function patch(body: Record<string, unknown>) {
    setSaving(true);
    setError("");
    const res = await fetch(`/api/admin/settings/staff/${member.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const json = await res.json();
    setSaving(false);
    if (!res.ok) { setError(json.error ?? "Update failed"); return false; }
    setEditing(false);
    onRefresh();
    return true;
  }

  async function toggleActive() {
    await patch({ active: !member.active });
  }

  async function saveEdit(e: React.FormEvent) {
    e.preventDefault();
    const body: Record<string, unknown> = { vesselId: vesselId || null };
    if (member.role === "mate" && newPin) body.pin = newPin;
    if (member.role === "admin" && newPassword) body.password = newPassword;
    await patch(body);
  }

  return (
    <div className="px-5 py-4">
      {editing ? (
        <form onSubmit={saveEdit} className="grid gap-3">
          {member.role === "mate" && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">New PIN (leave blank to keep)</label>
                <input className={inputCls} type="password" inputMode="numeric" pattern="\d{4,8}" value={newPin} onChange={(e) => setNewPin(e.target.value)} placeholder="4–8 digits" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Vessel</label>
                <select className={inputCls} value={vesselId} onChange={(e) => setVesselId(e.target.value)}>
                  <option value="">— unassigned —</option>
                  {vessels.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
                </select>
              </div>
            </div>
          )}
          {member.role === "admin" && (
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">New password (leave blank to keep)</label>
              <input className={inputCls} type="password" minLength={8} value={newPassword} onChange={(e) => setNewPassword(e.target.value)} />
            </div>
          )}
          {error && <p className="text-sm text-red-600">{error}</p>}
          <div className="flex gap-2">
            <button type="submit" disabled={saving} className="bg-blue-600 text-white px-3 py-1.5 rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50">
              {saving ? "Saving…" : "Save"}
            </button>
            <button type="button" onClick={() => setEditing(false)} className="border border-gray-300 text-gray-700 px-3 py-1.5 rounded-lg text-sm hover:bg-gray-50">Cancel</button>
          </div>
        </form>
      ) : (
        <div className="flex items-center gap-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-medium text-gray-900">{member.name}</span>
              <span className="text-xs px-2 py-0.5 rounded-full bg-blue-50 text-blue-700 capitalize">{member.role}</span>
              {!member.active && <span className="text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-500">Inactive</span>}
              {isMe && <span className="text-xs text-gray-400">(you)</span>}
            </div>
            <div className="text-sm text-gray-500 mt-0.5">
              {member.email}
              {member.vesselId && (
                <span className="ml-2">· {vessels.find((v) => v.id === member.vesselId)?.name ?? "—"}</span>
              )}
            </div>
          </div>
          <div className="flex gap-2 flex-shrink-0">
            <button onClick={() => setEditing(true)} className="text-sm text-blue-600 hover:text-blue-800 px-3 py-1.5 rounded-lg hover:bg-blue-50">Edit</button>
            {!isMe && (
              <button onClick={toggleActive} className="text-sm text-gray-500 hover:text-gray-700 px-3 py-1.5 rounded-lg hover:bg-gray-50">
                {member.active ? "Deactivate" : "Activate"}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default function StaffPage() {
  const [staffList, setStaffList] = useState<StaffMember[]>([]);
  const [vessels, setVessels] = useState<Vessel[]>([]);
  const [currentStaffId, setCurrentStaffId] = useState("");
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [tab, setTab] = useState<"admin" | "mate">("admin");

  async function load() {
    setLoading(true);
    const [sr, vr, me] = await Promise.all([
      fetch("/api/admin/settings/staff").then((r) => r.json()),
      fetch("/api/admin/settings/vessels").then((r) => r.json()),
      fetch("/api/admin/auth/me").then((r) => r.json()),
    ]);
    setStaffList(sr);
    setVessels(vr);
    setCurrentStaffId(me?.staffId ?? "");
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  async function createStaff(data: Record<string, unknown>): Promise<string | null> {
    const res = await fetch("/api/admin/settings/staff", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    const json = await res.json();
    if (!res.ok) return json.error ?? "Failed to create account";
    setAdding(false);
    await load();
    return null;
  }

  const filtered = staffList.filter((s) => s.role === tab);

  return (
    <div className="max-w-3xl mx-auto">
      <div className="flex items-center gap-3 mb-6">
        <a href="/admin/settings" className="text-sm text-gray-400 hover:text-gray-600">Settings</a>
        <span className="text-gray-300">›</span>
        <h1 className="text-2xl font-semibold text-gray-900">Staff</h1>
      </div>

      {loading ? (
        <div className="text-center text-gray-400 py-16">Loading…</div>
      ) : (
        <div className="space-y-4">
          <div className="flex gap-1 bg-gray-100 rounded-lg p-1 w-fit">
            {(["admin", "mate"] as const).map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors capitalize ${
                  tab === t ? "bg-white text-gray-900 shadow-sm" : "text-gray-500 hover:text-gray-700"
                }`}
              >
                {t}s ({staffList.filter((s) => s.role === t).length})
              </button>
            ))}
          </div>

          {tab === "admin" && (
            <p className="text-xs text-gray-400">Admins log in at /admin/login with email + password and have full access to the admin dashboard.</p>
          )}
          {tab === "mate" && (
            <p className="text-xs text-gray-400">Mates log in on the tablet app with their email + PIN. They can view manifests and check in passengers.</p>
          )}

          <div className="bg-white rounded-xl border border-gray-200 divide-y divide-gray-100">
            {filtered.map((m) => (
              <StaffRow key={m.id} member={m} vessels={vessels} currentStaffId={currentStaffId} onRefresh={load} />
            ))}
            {filtered.length === 0 && (
              <div className="text-center text-gray-400 py-10 text-sm">No {tab}s yet</div>
            )}
          </div>

          {adding ? (
            <StaffForm vessels={vessels} onSave={createStaff} onCancel={() => setAdding(false)} />
          ) : (
            <button
              onClick={() => setAdding(true)}
              className="w-full border-2 border-dashed border-gray-200 rounded-xl py-4 text-sm text-gray-400 hover:border-blue-300 hover:text-blue-500 transition-colors"
            >
              + Add {tab}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
