"use client";

import { useEffect, useState } from "react";
import { Lamp, Panel, fmtMoney, type LampTone } from "@/components/admin/merchant";
import type { ChargebackRow, ChargebackState } from "@/lib/disputes/list";

/** "Nov 17" in Eastern time. */
function fmtDay(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "America/New_York" });
}

const STATE: Record<ChargebackState, { word: string; tone: LampTone; filled: boolean }> = {
  inquiry: { word: "Bank inquiry", tone: "caution", filled: false },
  open: { word: "Open", tone: "alert", filled: true },
  under_review: { word: "Evidence sent", tone: "caution", filled: true },
  won: { word: "Won", tone: "go", filled: true },
  lost: { word: "Lost", tone: "alert", filled: false },
  closed: { word: "Closed", tone: "ink-3", filled: false },
};

// Stripe's dispute reasons, as the customer's bank put it.
const REASONS: Record<string, string> = {
  fraudulent: "says they didn't make the payment",
  unrecognized: "doesn't recognize the charge",
  product_not_received: "says the trip didn't happen",
  product_unacceptable: "says the trip wasn't as described",
  duplicate: "says they were charged twice",
  credit_not_processed: "says a promised refund never came",
  subscription_canceled: "says they cancelled",
  general: "gave no specific reason",
};

/** What the money did, in one line. */
function moneyLine(c: ChargebackRow): string {
  switch (c.state) {
    case "inquiry":
      return "No money has moved yet.";
    case "open":
    case "under_review":
      return `${fmtMoney(c.amountCents)} was taken from your Stripe balance until the bank decides.`;
    case "won":
      return `${fmtMoney(c.amountCents)} was returned to your Stripe balance.`;
    case "lost":
      return `The customer keeps ${fmtMoney(c.amountCents)}. Their tickets were refunded and your platform fee on them returned.`;
    case "closed":
      return "The bank closed its inquiry. No money moved.";
  }
}

function feeLine(fee: NonNullable<ChargebackRow["fee"]>): string {
  const amount = fmtMoney(fee.cents);
  if (fee.status === "collected") {
    return `Stripe's ${amount} chargeback fee was added to the platform fee on booking ${fee.collectedOn ?? "—"}.`;
  }
  return `Stripe's ${amount} chargeback fee will be added to the platform fee on your next booking.`;
}

/**
 * Chargebacks on the operator's bookings (row 11): open ones first in time
 * order, what happened to the money, and Stripe's fee. Hidden when there are
 * none.
 */
export function Chargebacks() {
  const [items, setItems] = useState<ChargebackRow[] | null>(null);

  useEffect(() => {
    fetch("/api/admin/payments/chargebacks")
      .then((res) => (res.ok ? (res.json() as Promise<{ items: ChargebackRow[] }>) : null))
      .then((body) => setItems(body?.items ?? []))
      .catch(() => setItems([]));
  }, []);

  if (!items || items.length === 0) return null;

  return (
    <Panel aria-labelledby="mo-chargebacks">
      <div className="flex items-center gap-2.5 px-5 py-4 border-b-2 border-ob-rule max-md:px-4">
        <h2 id="mo-chargebacks" className="text-title-panel">
          Chargebacks
        </h2>
        <span className="font-num text-body text-ob-ink-2">{items.length}</span>
      </div>
      <ul>
        {items.map((c) => {
          const state = STATE[c.state];
          const waiting = c.state === "open" || c.state === "inquiry";
          return (
            <li key={c.id} className="px-5 py-4 border-t border-ob-hair first:border-t-0 max-md:px-4">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <span className="inline-flex items-center gap-2 text-body font-bold">
                  <Lamp tone={state.tone} shape={state.filled ? "filled" : "hollow"} />
                  {state.word}
                </span>
                <span className="font-num text-body">{fmtMoney(c.amountCents)}</span>
                {c.confirmationCode && (
                  <span className="text-body-sm text-ob-ink-2">
                    Booking <span className="font-num text-ob-ink">{c.confirmationCode}</span>
                  </span>
                )}
                <span className="text-body-sm text-ob-ink-2">
                  Opened <span className="font-num">{fmtDay(c.openedAt)}</span>
                  {c.closedAt && (
                    <>
                      {" · closed "}
                      <span className="font-num">{fmtDay(c.closedAt)}</span>
                    </>
                  )}
                </span>
              </div>
              <div className="mt-1 text-body-sm text-ob-ink-2">
                The customer&rsquo;s bank {REASONS[c.reason] ?? `gave the reason “${c.reason}”`}. {moneyLine(c)}
              </div>
              {waiting && c.respondBy && (
                <div className="mt-1 text-body-sm font-bold text-ob-alert-ink">
                  Evidence is due by <span className="font-num">{fmtDay(c.respondBy)}</span>: who boarded, the booking
                  terms, any messages with the customer.
                </div>
              )}
              {c.fee && <div className="mt-1 text-body-sm text-ob-ink-2">{feeLine(c.fee)}</div>}
            </li>
          );
        })}
      </ul>
    </Panel>
  );
}
