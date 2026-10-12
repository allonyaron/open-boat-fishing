"use client";

// The web cart: the one copy of what the customer has picked, shared by /book,
// /cart, /checkout and the nav button, and persisted to localStorage (P8-16).
// It holds trip snapshots and quantities only; totals come from the server's
// quote (useQuote).

import { useSyncExternalStore } from "react";
import {
  type CartLine,
  adjustQuantity,
  cartMonths,
  parseStoredCart,
  reconcileCart,
  removeTrip,
  serializeCart,
  setQuantity,
} from "@openboat/utils";
import type { Trip } from "@/components/BookingCalendar/types";

export const CART_STORAGE_KEY = "openboat_cart";

export type WebCartLine = CartLine<Trip>;

type Snapshot = {
  lines: WebCartLine[];
  /** False until the stored cart has been read (always false on the server). */
  ready: boolean;
  /** Set when restoring brought the cart up to date with current prices or seats. */
  updatedOnRestore: boolean;
};

const SERVER_SNAPSHOT: Snapshot = { lines: [], ready: false, updatedOnRestore: false };
let snapshot: Snapshot = SERVER_SNAPSHOT;
const listeners = new Set<() => void>();
let started = false;

function emit(next: Partial<Snapshot>) {
  snapshot = { ...snapshot, ...next };
  listeners.forEach((l) => l());
}

function persist(lines: WebCartLine[]) {
  try {
    if (lines.length === 0) localStorage.removeItem(CART_STORAGE_KEY);
    else localStorage.setItem(CART_STORAGE_KEY, serializeCart(lines));
  } catch {
    /* storage unavailable: the cart lasts as long as the page */
  }
}

function readStored(): WebCartLine[] {
  try {
    return parseStoredCart<Trip>(localStorage.getItem(CART_STORAGE_KEY));
  } catch {
    return [];
  }
}

/**
 * Re-checks a restored cart against the trips as listed now (prices and
 * status; seats are the booking's call), so a cart saved hours ago can't
 * show stale prices or a trip that has stopped selling (P8-3).
 */
async function revalidate() {
  const months = cartMonths(snapshot.lines);
  if (months.length === 0) return;
  try {
    const lists = await Promise.all(
      months.map((m) =>
        fetch(`/api/trips?month=${m}`).then((r) => {
          if (!r.ok) throw new Error(`trips ${m}: ${r.status}`);
          return r.json() as Promise<Trip[]>;
        }),
      ),
    );
    // Applied to the cart as it is now: the customer may have changed it meanwhile.
    const { lines, changed } = reconcileCart(snapshot.lines, lists.flat(), months);
    persist(lines);
    emit({ lines, updatedOnRestore: snapshot.updatedOnRestore || changed });
  } catch {
    /* offline or a server error: keep the cart; the quote and the booking re-check it */
  }
}

function start() {
  if (started || typeof window === "undefined") return;
  started = true;
  // The old cart countdown's key (P8-10); nothing writes it now.
  try {
    localStorage.removeItem("openboat_hold_expires");
  } catch {
    /* ignore */
  }
  const lines = readStored();
  persist(lines); // drops an expired or old-format cart
  emit({ lines, ready: true });
  void revalidate();
  // Another tab changed the cart.
  window.addEventListener("storage", (e) => {
    if (e.key === CART_STORAGE_KEY) emit({ lines: readStored() });
  });
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  // Read storage after hydration, so the server render and the first client
  // render agree (the /book trip list is server-rendered, P8-2).
  queueMicrotask(start);
  return () => listeners.delete(listener);
}

function update(next: WebCartLine[]) {
  persist(next);
  emit({ lines: next });
}

// Actions read the stored cart first, so one made before any component
// subscribed can't overwrite it with an empty one.
function current(): WebCartLine[] {
  start();
  return snapshot.lines;
}

export const cart = {
  adjust(trip: Trip, ticketType: string, delta: number) {
    update(adjustQuantity(current(), trip, ticketType, delta));
  },
  set(trip: Trip, ticketType: string, quantity: number) {
    update(setQuantity(current(), trip, ticketType, quantity));
  },
  remove(tripId: string) {
    update(removeTrip(current(), tripId));
  },
  clear() {
    start();
    update([]);
  },
};

export function useCartStore(): Snapshot {
  return useSyncExternalStore(
    subscribe,
    () => snapshot,
    () => SERVER_SNAPSHOT,
  );
}
