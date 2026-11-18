import { fmtMoney } from "./clock";
import type { ToastKind } from "./Toast";

// Toast wording for actions that send refunds (row 10). Refunds are recorded
// first and sent after, so the money can lag the action: say which.

type RefundCounts = { sent: number; queued: number; failed: number };

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

export function tripCancelledMessage(refunds: RefundCounts | undefined): { text: string; kind: ToastKind } {
  const r = refunds ?? { sent: 0, queued: 0, failed: 0 };
  if (r.sent + r.queued + r.failed === 0) return { text: "Trip cancelled.", kind: "done" };
  if (r.failed > 0) {
    return {
      text: `Trip cancelled, but Stripe refused ${plural(r.failed, "refund")}. See Money → Needs attention.`,
      kind: "error",
    };
  }
  if (r.queued > 0) {
    return {
      text: `Trip cancelled. ${r.sent > 0 ? `${plural(r.sent, "refund")} sent; ` : ""}${plural(r.queued, "refund")} will go out once Stripe responds.`,
      kind: "done",
    };
  }
  return { text: `Trip cancelled. ${plural(r.sent, "refund")} sent to customers.`, kind: "done" };
}

export function ticketRefundedMessage(
  refundedCents: number,
  refund: "sent" | "queued" | "failed" | undefined,
): { text: string; kind: ToastKind } {
  const amount = fmtMoney(refundedCents);
  if (refund === "failed") {
    return {
      text: `Ticket refunded and the seat is back on sale, but Stripe refused the ${amount}. See Money → Needs attention.`,
      kind: "error",
    };
  }
  if (refund === "queued") {
    return {
      text: `Ticket refunded and the seat is back on sale. The ${amount} will go back once Stripe responds.`,
      kind: "done",
    };
  }
  return { text: `Refunded ${amount}. The seat is back on sale.`, kind: "done" };
}
