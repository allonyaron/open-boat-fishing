import { dollars } from "@openboat/utils";
import { type QuoteState, shownQuote } from "./quote";

/** What the cart UIs show from a quote: the total, the discount and each line's subtotal. */
export function quoteView(state: QuoteState) {
  const { quote, updating } = shownQuote(state);
  const error = state.status === "error" ? state.message : null;
  return {
    /** The total, "…" while the first quote loads, "—" when it failed. */
    total: quote ? dollars(quote.totalCents) : error ? "—" : "…",
    updating,
    error,
    discountCents: quote?.discountCents ?? 0,
    /** A line's list subtotal (before the group discount). */
    lineSubtotal(tripId: string): string {
      const line = quote?.lines.find((l) => l.tripId === tripId);
      return line ? dollars(line.listCents) : "…";
    },
    /** One fare's list subtotal on a line (unit price × quantity). */
    fareSubtotal(tripId: string, ticketType: string): string {
      const fare = quote?.lines.find((l) => l.tripId === tripId)?.fares.find((f) => f.ticketType === ticketType);
      return fare ? dollars(fare.listCents) : "…";
    },
  };
}

export type QuoteView = ReturnType<typeof quoteView>;
