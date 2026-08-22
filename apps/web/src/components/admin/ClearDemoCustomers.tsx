"use client";

import { useState } from "react";

export function ClearDemoCustomers() {
  const [state, setState] = useState<"idle" | "confirming" | "loading" | "done" | "error">(
    "idle",
  );
  const [message, setMessage] = useState<string | null>(null);

  async function run() {
    setState("loading");
    setMessage(null);
    try {
      const res = await fetch("/api/admin/demo/clear-customers", { method: "POST" });
      const body = await res.json();
      if (!res.ok) {
        setState("error");
        setMessage(body.error ?? "Failed to clear demo customers");
        return;
      }
      setState("done");
      setMessage(
        `Cleared ${body.customersDeleted} customer(s) and reset ${body.tripsReset} trip(s).`,
      );
    } catch (err) {
      setState("error");
      setMessage(err instanceof Error ? err.message : "Network error");
    }
  }

  return (
    <div className="mt-8 border border-amber-300 rounded-xl bg-amber-50 px-6 py-5">
      <div className="text-sm font-semibold text-amber-900 uppercase tracking-wide">
        Demo tools
      </div>
      <div className="mt-2 text-sm text-amber-900">
        Wipe all bookings, tickets, payments, and customer accounts. Trips are reset to full
        availability. Operator, vessels, schedules, and fishing reports are preserved.
      </div>
      {state === "idle" && (
        <button
          type="button"
          onClick={() => setState("confirming")}
          className="mt-4 inline-flex items-center px-4 py-2 rounded-md bg-amber-600 text-white text-sm font-medium hover:bg-amber-700"
        >
          Clear demo customers
        </button>
      )}
      {state === "confirming" && (
        <div className="mt-4 flex gap-2">
          <button
            type="button"
            onClick={run}
            className="inline-flex items-center px-4 py-2 rounded-md bg-red-600 text-white text-sm font-medium hover:bg-red-700"
          >
            Yes, wipe everything
          </button>
          <button
            type="button"
            onClick={() => setState("idle")}
            className="inline-flex items-center px-4 py-2 rounded-md border border-amber-300 text-amber-900 text-sm font-medium hover:bg-amber-100"
          >
            Cancel
          </button>
        </div>
      )}
      {state === "loading" && <div className="mt-4 text-sm text-amber-900">Working…</div>}
      {state === "done" && <div className="mt-4 text-sm text-green-800">{message}</div>}
      {state === "error" && <div className="mt-4 text-sm text-red-700">{message}</div>}
    </div>
  );
}
