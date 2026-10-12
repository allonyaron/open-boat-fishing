// The cart's total, from the server (POST /api/bookings/quote, P8-3). Every
// total the app shows before a booking exists comes from here.

import { useCallback, useEffect, useRef, useState } from "react";
import { type CartLine, type CartTrip, type Quote, cartKey, toApiCart } from "@openboat/utils";
import { API_URL } from "@/lib/api";

export type QuoteState =
  | { status: "empty" }
  | { status: "loading"; previous: Quote | null }
  | { status: "ready"; quote: Quote }
  | { status: "error"; message: string };

const DEBOUNCE_MS = 250;

export function useQuote(lines: CartLine<CartTrip>[]): QuoteState & { refresh: () => void } {
  const key = cartKey(lines);
  const [state, setState] = useState<QuoteState>(key ? { status: "loading", previous: null } : { status: "empty" });
  const [nonce, setNonce] = useState(0);
  const linesRef = useRef(lines);
  linesRef.current = lines;
  const last = useRef<Quote | null>(null);

  useEffect(() => {
    if (!key) {
      setState({ status: "empty" });
      return;
    }
    setState({ status: "loading", previous: last.current });
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`${API_URL}/api/bookings/quote`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ cart: toApiCart(linesRef.current) }),
          signal: controller.signal,
        });
        const data = (await res.json().catch(() => ({}))) as Quote & { error?: string };
        if (!res.ok) {
          setState({
            status: "error",
            message: res.status === 429 ? "Too many updates. Wait a moment." : (data.error ?? "We couldn't price your seats."),
          });
          return;
        }
        last.current = data;
        setState({ status: "ready", quote: data });
      } catch {
        if (!controller.signal.aborted) {
          setState({ status: "error", message: "Could not connect to server. Check your connection." });
        }
      }
    }, DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [key, nonce]);

  const refresh = useCallback(() => setNonce((n) => n + 1), []);
  return { ...state, refresh };
}

/** The quote to show: the current one, or the last one while a new one loads. */
export function shownQuote(state: QuoteState): { quote: Quote | null; updating: boolean } {
  if (state.status === "ready") return { quote: state.quote, updating: false };
  if (state.status === "loading") return { quote: state.previous, updating: true };
  return { quote: null, updating: false };
}
