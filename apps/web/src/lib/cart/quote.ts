"use client";

// The cart's total, from the server (POST /api/bookings/quote, P8-3). Every
// total the web shows comes from here; nothing adds up prices on the client.

import { useCallback, useEffect, useRef, useState } from "react";
import { type CartLine, type CartTrip, type Quote, cartKey, toApiCart } from "@openboat/utils";

export type QuoteState =
  | { status: "empty" }
  | { status: "loading"; previous: Quote | null }
  | { status: "ready"; quote: Quote }
  | { status: "error"; message: string; previous: Quote | null };

// Rapid stepper taps settle before a request goes out.
const DEBOUNCE_MS = 250;

// The last quote per cart, so moving between /book, /cart and /checkout shows
// a total at once. It is refreshed in the background every time.
const cache = new Map<string, Quote>();

export async function fetchQuote(lines: CartLine<CartTrip>[], signal?: AbortSignal): Promise<Quote> {
  const res = await fetch("/api/bookings/quote", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ cart: toApiCart(lines) }),
    signal,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new QuoteError(
      res.status === 429
        ? "Too many updates. Wait a moment and try again."
        : ((data as { error?: string }).error ?? "We couldn't price your cart. Please try again."),
    );
  }
  cache.set(cartKey(lines), data as Quote);
  return data as Quote;
}

export class QuoteError extends Error {}

/**
 * The quote for `lines`, re-fetched whenever the cart's content changes.
 * `refresh()` fetches again for the same cart (e.g. after the booking
 * reports a different total).
 */
export function useQuote(lines: CartLine<CartTrip>[]): QuoteState & { refresh: () => void } {
  const key = cartKey(lines);
  const [state, setState] = useState<QuoteState>(() => initialState(key));
  const [nonce, setNonce] = useState(0);
  const linesRef = useRef(lines);
  linesRef.current = lines;
  const lastQuote = useRef<Quote | null>(null);

  useEffect(() => {
    if (!key) {
      setState({ status: "empty" });
      return;
    }
    const cached = cache.get(key);
    if (cached) lastQuote.current = cached;
    setState(cached ? { status: "ready", quote: cached } : { status: "loading", previous: lastQuote.current });
    const controller = new AbortController();
    const timer = setTimeout(() => {
      fetchQuote(linesRef.current, controller.signal)
        .then((quote) => {
          lastQuote.current = quote;
          setState({ status: "ready", quote });
        })
        .catch((err: unknown) => {
          if (controller.signal.aborted) return;
          setState({
            status: "error",
            message: err instanceof QuoteError ? err.message : "We couldn't price your cart. Check your connection.",
            previous: lastQuote.current,
          });
        });
    }, cached ? 0 : DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [key, nonce]);

  const refresh = useCallback(() => {
    cache.delete(key);
    setNonce((n) => n + 1);
  }, [key]);

  return { ...state, refresh };
}

function initialState(key: string): QuoteState {
  if (!key) return { status: "empty" };
  const cached = cache.get(key);
  return cached ? { status: "ready", quote: cached } : { status: "loading", previous: null };
}

/** The quote to show: the current one, or while a new one loads, the last one (shown as updating). */
export function shownQuote(state: QuoteState): { quote: Quote | null; updating: boolean } {
  switch (state.status) {
    case "ready":
      return { quote: state.quote, updating: false };
    case "loading":
      return { quote: state.previous, updating: true };
    case "error":
      return { quote: null, updating: false };
    default:
      return { quote: null, updating: false };
  }
}
