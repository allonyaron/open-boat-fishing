import { useCallback, useEffect, useState } from "react";
import { getDisplayPrices } from "./format";
import type { EnrichedCartItem, Trip } from "./types";

export function useCart({
  trips,
  initialTripId,
  initialTrips,
  onInitialTripPreAdded,
}: {
  trips: Trip[];
  initialTripId?: string;
  initialTrips: Trip[];
  onInitialTripPreAdded?: (departureDate: string) => void;
}) {
  // cart: tripId:ticketType -> quantity
  const [cart, setCart] = useState<Map<string, number>>(new Map());
  // cached prices so total stays correct across month navigation
  const [cartPrices, setCartPrices] = useState<Map<string, number>>(new Map());
  // enriched cart items (written to localStorage for checkout page)
  const [cartItems, setCartItems] = useState<EnrichedCartItem[]>([]);

  // Restore cart from localStorage, then pre-add initialTripId if provided.
  // Both steps live in one effect so the pre-add's dedupe check can read the
  // just-restored items (not stale state).
  useEffect(() => {
    let restoredItems: EnrichedCartItem[] = [];
    try {
      const raw = localStorage.getItem("openboat_cart");
      if (raw) {
        const parsed: EnrichedCartItem[] = JSON.parse(raw);
        const seen = new Set<string>();
        restoredItems = parsed.filter((item) => {
          if (seen.has(item.tripId)) return false;
          seen.add(item.tripId);
          return true;
        });
        const map = new Map<string, number>();
        const prices = new Map<string, number>();
        restoredItems.forEach((item) => {
          item.tickets.forEach((t) => {
            map.set(`${item.tripId}:${t.ticketType}`, t.quantity);
            prices.set(`${item.tripId}:${t.ticketType}`, t.priceCents);
          });
        });
        if (map.size > 0) setCart(map);
        if (prices.size > 0) setCartPrices(prices);
        if (restoredItems.length > 0) setCartItems(restoredItems);
      }
    } catch { /* ignore corrupt data */ }

    // Pre-add 1 adult ticket for the initial trip (homepage BOOK button)
    if (initialTripId && !restoredItems.some((i) => i.tripId === initialTripId)) {
      const trip = initialTrips.find((t) => t.id === initialTripId);
      if (trip) {
        const adultPrice =
          trip.product.prices.find((p) => p.ticketType.toLowerCase() === "adult") ??
          trip.product.prices[0];
        if (adultPrice && trip.seatsRemaining > 0) {
          const k = `${trip.id}:${adultPrice.ticketType}`;
          setCart((prev) => new Map(prev).set(k, 1));
          setCartPrices((prev) => new Map(prev).set(k, adultPrice.priceCents));
          setCartItems((prev) => [
            ...prev,
            {
              tripId: trip.id,
              departureDate: trip.departureDate,
              startTime: trip.startTime,
              endTime: trip.endTime,
              vesselName: trip.vessel.name,
              vesselColor: trip.vessel.color,
              category: trip.product.category,
              productName: trip.product.displayName,
              seatsRemaining: trip.seatsRemaining,
              tickets: [{ ticketType: adultPrice.ticketType, quantity: 1, priceCents: adultPrice.priceCents }],
            },
          ]);
          onInitialTripPreAdded?.(trip.departureDate);
        }
      }
    }
  }, []);

  // Sync cartItems to localStorage
  useEffect(() => {
    if (cartItems.length === 0) {
      localStorage.removeItem("openboat_cart");
    } else {
      localStorage.setItem("openboat_cart", JSON.stringify(cartItems));
    }
  }, [cartItems]);

  const getQty = useCallback(
    (tripId: string, ticketType: string) => cart.get(`${tripId}:${ticketType}`) ?? 0,
    [cart],
  );

  const totalQtyForTrip = useCallback(
    (tripId: string) =>
      Array.from(cart.entries())
        .filter(([k]) => k.startsWith(`${tripId}:`))
        .reduce((sum, [, v]) => sum + v, 0),
    [cart],
  );

  // §4: Delta-based functional state update — prevents stale-closure seat drops on rapid taps.
  // Both setCart and setCartItems derive new quantities from their own prev, never from the render
  // closure. Flag: no other setState(absoluteValue) patterns remain in the stepper path.
  const adjustQty = useCallback((tripId: string, ticketType: string, delta: 1 | -1) => {
    const trip = trips.find((t) => t.id === tripId);
    if (!trip) return;

    const k = `${tripId}:${ticketType}`;
    const price = trip.product.prices.find((p) => p.ticketType === ticketType);

    if (price) {
      setCartPrices((prev) => new Map(prev).set(k, price.priceCents));
    }

    setCart((prev) => {
      const next = new Map(prev);
      const otherQty = trip.product.prices
        .filter((p) => p.ticketType !== ticketType)
        .reduce((sum, p) => sum + (next.get(`${tripId}:${p.ticketType}`) ?? 0), 0);
      const maxForType = trip.seatsRemaining - otherQty;
      const currentQty = next.get(k) ?? 0;
      const newQty = Math.max(0, Math.min(maxForType, currentQty + delta));
      if (newQty === 0) next.delete(k);
      else next.set(k, newQty);
      return next;
    });

    const displayPrices = getDisplayPrices(trip.product.prices);
    const isCollapsed = displayPrices.length === 1 && displayPrices[0].displayLabel === "seat";
    const displayLabel = isCollapsed ? "seat" : ticketType;

    setCartItems((prev) => {
      const existing = prev.find((i) => i.tripId === tripId);
      const without = prev.filter((i) => i.tripId !== tripId);

      const existingQty = existing?.tickets.find((t) => t.ticketType === ticketType)?.quantity ?? 0;
      const otherTickets = existing?.tickets.filter((t) => t.ticketType !== ticketType) ?? [];
      const otherQty = otherTickets.reduce((s, t) => s + t.quantity, 0);
      const maxForType = trip.seatsRemaining - otherQty;
      const newQty = Math.max(0, Math.min(maxForType, existingQty + delta));

      const newTickets = otherTickets.filter((t) => t.quantity > 0).map((t) => ({
        ...t,
        displayLabel: isCollapsed ? "seat" : t.ticketType,
      }));
      if (newQty > 0 && price) {
        newTickets.push({ ticketType, quantity: newQty, priceCents: price.priceCents, displayLabel });
      }

      if (newTickets.length === 0) return without;
      return [
        ...without,
        {
          tripId: trip.id,
          departureDate: trip.departureDate,
          startTime: trip.startTime,
          endTime: trip.endTime,
          vesselName: trip.vessel.name,
          vesselColor: trip.vessel.color,
          category: trip.product.category,
          productName: trip.product.displayName,
          seatsRemaining: trip.seatsRemaining,
          tickets: newTickets,
        },
      ];
    });

  }, [trips]);

  // Returns the removed item so the caller can announce it.
  const removeFromCart = useCallback((tripId: string): EnrichedCartItem | undefined => {
    const item = cartItems.find((i) => i.tripId === tripId);
    const trip = trips.find((t) => t.id === tripId);
    const keys = trip
      ? trip.product.prices.map((p) => `${tripId}:${p.ticketType}`)
      : Array.from(cart.keys()).filter((k) => k.startsWith(`${tripId}:`));
    setCart((prev) => {
      const next = new Map(prev);
      keys.forEach((k) => next.delete(k));
      return next;
    });
    setCartItems((prev) => prev.filter((i) => i.tripId !== tripId));
    return item;
  }, [cart, cartItems, trips]);

  const totalCents = Array.from(cart.entries()).reduce(
    (sum, [key, qty]) => sum + qty * (cartPrices.get(key) ?? 0),
    0,
  );
  const totalSeats = Array.from(cart.values()).reduce((a, b) => a + b, 0);

  return {
    cart,
    cartItems,
    getQty,
    totalQtyForTrip,
    adjustQty,
    removeFromCart,
    totalCents,
    totalSeats,
  };
}
