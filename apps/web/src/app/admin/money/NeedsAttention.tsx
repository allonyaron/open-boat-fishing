"use client";

import { useCallback, useEffect, useState } from "react";
import { Button, Lamp, Panel, fmtMoney, useToast } from "@/components/admin/merchant";
import type { AttentionItem } from "@/lib/payments/attention";

/** "Nov 17, 2:05 PM" in Eastern time. */
function fmtWhen(iso: string): string {
  return new Date(iso).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "America/New_York",
  });
}

const RETRY_MESSAGES: Record<string, { text: string; kind: "done" | "error" }> = {
  sent: { text: "Refund sent to Stripe.", kind: "done" },
  confirmed: { text: "Refund sent to Stripe.", kind: "done" },
  pending: { text: "Stripe still isn't answering. It will be tried again automatically.", kind: "error" },
  failed: { text: "Stripe refused the refund again. See the reason below.", kind: "error" },
  skipped: { text: "That refund is already being sent.", kind: "done" },
};

/**
 * Refunds Stripe refused or hasn't received yet, and payment events that need
 * a person (row 10). Hidden when there is nothing to show.
 */
export function NeedsAttention() {
  const { showToast } = useToast();
  const [items, setItems] = useState<AttentionItem[] | null>(null);
  const [failedToLoad, setFailedToLoad] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/payments/attention");
      if (!res.ok) throw new Error(String(res.status));
      const body = (await res.json()) as { items: AttentionItem[] };
      setItems(body.items);
      setFailedToLoad(false);
    } catch {
      setFailedToLoad(true);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function act(item: AttentionItem, action: "retry" | "resolve") {
    setBusy(`${item.id}:${action}`);
    try {
      const res = await fetch(`/api/admin/payments/attention/${item.kind}/${item.id}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const body = (await res.json().catch(() => ({}))) as { result?: string; error?: string };
      if (!res.ok) {
        showToast(body.error ?? "That didn't work. Try again.", "error");
      } else if (action === "retry") {
        const msg = RETRY_MESSAGES[body.result ?? ""] ?? RETRY_MESSAGES.sent;
        showToast(msg.text, msg.kind);
      } else {
        showToast("Marked as dealt with.");
      }
      await load();
    } finally {
      setBusy(null);
    }
  }

  if (failedToLoad) {
    return (
      <div role="status" className="text-body-sm text-ob-alert-ink">
        Couldn&rsquo;t check for payment problems.{" "}
        <button type="button" className="underline font-bold" onClick={() => void load()}>
          Try again
        </button>
      </div>
    );
  }
  if (!items || items.length === 0) return null;

  return (
    <Panel aria-labelledby="mo-attention">
      <div className="flex items-center gap-2.5 px-5 py-4 border-b-2 border-ob-rule max-md:px-4">
        <Lamp tone="alert" />
        <h2 id="mo-attention" className="text-title-panel">
          Needs attention
        </h2>
        <span className="font-num text-body text-ob-ink-2">{items.length}</span>
      </div>
      <ul>
        {items.map((item) => (
          <li
            key={`${item.kind}:${item.id}`}
            className="flex flex-wrap items-start justify-between gap-x-5 gap-y-3 px-5 py-4 border-t border-ob-hair first:border-t-0 max-md:px-4"
          >
            <div className="flex-[1_1_320px] min-w-0">
              <div className="text-body font-bold">
                {item.what}
                {item.amountCents !== null && (
                  <span className="font-num text-ob-alert-ink"> · {fmtMoney(item.amountCents)}</span>
                )}
              </div>
              <div className="text-body-sm text-ob-ink-2">
                <span className="font-num">{fmtWhen(item.at)}</span>
                {item.confirmationCode && (
                  <>
                    {" · Booking "}
                    <span className="font-num text-ob-ink">{item.confirmationCode}</span>
                  </>
                )}
              </div>
              {item.detail && (
                <div className="mt-1 text-body-sm text-ob-ink-2 [overflow-wrap:anywhere]">{item.detail}</div>
              )}
            </div>
            <div className="flex gap-2.5 max-md:w-full">
              {item.canRetry && (
                <Button
                  variant="strong"
                  onClick={() => void act(item, "retry")}
                  disabled={busy !== null}
                  className="max-md:flex-1"
                >
                  {busy === `${item.id}:retry` ? "Sending…" : "Try again"}
                </Button>
              )}
              {item.canResolve && (
                <Button onClick={() => void act(item, "resolve")} disabled={busy !== null} className="max-md:flex-1">
                  {busy === `${item.id}:resolve` ? "Saving…" : "Mark dealt with"}
                </Button>
              )}
            </div>
          </li>
        ))}
      </ul>
    </Panel>
  );
}
