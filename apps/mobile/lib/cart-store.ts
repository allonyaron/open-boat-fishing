// The consumer app's cart: the one copy of what the customer has picked,
// shared by the Trips tab (and its resume bar), the cart screen and checkout,
// persisted in MMKV (P8-16). It holds trip snapshots, so a trip picked in
// another month stays in the cart (P8-4). Totals come from the server's
// quote (useQuote).

import { useSyncExternalStore } from "react";
import { MMKV } from "react-native-mmkv";
import {
  type CartLine,
  adjustQuantity,
  cartMonths,
  parseStoredCart,
  reconcileCart,
  removeTrip,
  serializeCart,
} from "@openboat/utils";
import { API_URL } from "@/lib/api";
import type { Trip } from "@/lib/trip-helpers";

const storage = new MMKV();
const CART_KEY = "cart";

export type AppCartLine = CartLine<Trip>;

type Snapshot = { lines: AppCartLine[]; updatedOnRestore: boolean };

let snapshot: Snapshot = { lines: [], updatedOnRestore: false };
const listeners = new Set<() => void>();
let started = false;

function emit(next: Partial<Snapshot>) {
  snapshot = { ...snapshot, ...next };
  listeners.forEach((l) => l());
}

function persist(lines: AppCartLine[]) {
  if (lines.length === 0) storage.delete(CART_KEY);
  else storage.set(CART_KEY, serializeCart(lines));
}

/** Re-checks a restored cart against the trips as listed now (P8-3). */
async function revalidate() {
  const months = cartMonths(snapshot.lines);
  if (months.length === 0) return;
  try {
    const lists = await Promise.all(
      months.map(async (m) => {
        const res = await fetch(`${API_URL}/api/trips?month=${m}`);
        if (!res.ok) throw new Error(`trips ${m}: ${res.status}`);
        return (await res.json()) as Trip[];
      }),
    );
    const { lines, changed } = reconcileCart(snapshot.lines, lists.flat(), months);
    persist(lines);
    emit({ lines, updatedOnRestore: snapshot.updatedOnRestore || changed });
  } catch {
    /* offline: keep the cart; the quote and the booking re-check it */
  }
}

function start() {
  if (started) return;
  started = true;
  // Keys from before the store: the checkout hand-off and its paid flag.
  storage.delete("pending_checkout");
  storage.delete("cart_paid");
  const lines = parseStoredCart<Trip>(storage.getString(CART_KEY));
  persist(lines); // drops an expired or unreadable cart
  snapshot = { ...snapshot, lines };
  void revalidate();
}

function update(next: AppCartLine[]) {
  start();
  persist(next);
  emit({ lines: next });
}

export const cart = {
  adjust(trip: Trip, ticketType: string, delta: number) {
    start();
    update(adjustQuantity(snapshot.lines, trip, ticketType, delta));
  },
  remove(tripId: string) {
    start();
    update(removeTrip(snapshot.lines, tripId));
  },
  clear() {
    update([]);
  },
};

function subscribe(listener: () => void) {
  start();
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useAppCart(): Snapshot {
  return useSyncExternalStore(subscribe, () => {
    start();
    return snapshot;
  });
}
