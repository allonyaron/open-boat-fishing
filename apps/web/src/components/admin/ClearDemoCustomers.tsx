"use client";

import { useState } from "react";
import { Button, Lamp } from "@/components/admin/merchant";

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
    <section
      aria-labelledby="sd-h"
      className="flex flex-col gap-2.5 p-5 bg-ob-panel border-2 border-dashed border-ob-alert rounded-ob max-md:px-4"
    >
      <div className="flex items-center gap-2.5">
        <Lamp tone="alert" />
        <h2 id="sd-h" className="text-18 font-extrabold">
          Demo tools
        </h2>
      </div>
      <p className="m-0 text-body-sm text-ob-ink-2 max-w-[70ch]">
        Wipe all bookings, tickets, payments, and customer accounts. Trips are reset to full
        availability. Operator, vessels, schedules, and fishing reports are preserved.
      </p>
      {state === "idle" && (
        <Button variant="danger" className="self-start" onClick={() => setState("confirming")}>
          Clear demo customers
        </Button>
      )}
      {state === "confirming" && (
        <div className="flex flex-wrap gap-2.5">
          <Button variant="danger-confirm" icon={false} onClick={run}>
            Yes, wipe everything
          </Button>
          <Button variant="secondary" onClick={() => setState("idle")}>
            Cancel
          </Button>
        </div>
      )}
      <div role="status" className="text-body-sm font-semibold">
        {state === "loading" && <span className="text-ob-ink-2">Working…</span>}
        {state === "done" && <span className="text-ob-go-ink">{message}</span>}
        {state === "error" && <span className="text-ob-alert-ink">{message}</span>}
      </div>
    </section>
  );
}
