import { useCallback, useEffect, useMemo, useRef } from "react";
import { lineFares, quantityOf, totalSeats as countSeats } from "@openboat/utils";
import { cart, useCartStore, type WebCartLine } from "@/lib/cart/store";
import { useQuote } from "@/lib/cart/quote";
import { getDisplayPrices } from "./format";
import type { EnrichedCartItem, Trip } from "./types";

/** A cart line as the rail and the mobile bar show it. */
export function toCartItem(line: WebCartLine): EnrichedCartItem {
  const { trip } = line;
  const display = getDisplayPrices(trip.product.prices);
  const collapsed = display.length === 1 && display[0].displayLabel === "seat";
  return {
    tripId: trip.id,
    departureDate: trip.departureDate,
    startTime: trip.startTime,
    endTime: trip.endTime,
    vesselName: trip.vessel.name,
    vesselColor: trip.vessel.color,
    category: trip.product.category,
    productName: trip.product.displayName,
    seatsRemaining: trip.seatsRemaining,
    tickets: lineFares(line).map((f) => ({ ...f, displayLabel: collapsed ? "seat" : f.ticketType })),
  };
}

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
  const { lines, ready } = useCartStore();
  const quote = useQuote(lines);

  // Pre-add 1 adult ticket when arriving from the homepage BOOK button, once
  // the stored cart has been read (so a trip already in it isn't added twice).
  const preAdded = useRef(false);
  useEffect(() => {
    if (!ready || preAdded.current) return;
    preAdded.current = true;
    if (!initialTripId || lines.some((l) => l.trip.id === initialTripId)) return;
    const trip = initialTrips.find((t) => t.id === initialTripId);
    if (!trip || trip.seatsRemaining <= 0) return;
    const adult =
      trip.product.prices.find((p) => p.ticketType.toLowerCase() === "adult") ?? trip.product.prices[0];
    if (!adult) return;
    cart.adjust(trip, adult.ticketType, 1);
    onInitialTripPreAdded?.(trip.departureDate);
  }, [ready, lines, initialTripId, initialTrips, onInitialTripPreAdded]);

  const getQty = useCallback(
    (tripId: string, ticketType: string) => quantityOf(lines, tripId, ticketType),
    [lines],
  );

  // The listed trip is the fresh snapshot: it carries current prices and seats.
  const adjustQty = useCallback(
    (tripId: string, ticketType: string, delta: 1 | -1) => {
      const trip = trips.find((t) => t.id === tripId);
      if (trip) cart.adjust(trip, ticketType, delta);
    },
    [trips],
  );

  // Returns the removed item so the caller can announce it.
  const removeFromCart = useCallback(
    (tripId: string): EnrichedCartItem | undefined => {
      const line = lines.find((l) => l.trip.id === tripId);
      cart.remove(tripId);
      return line && toCartItem(line);
    },
    [lines],
  );

  const cartItems = useMemo(() => lines.map(toCartItem), [lines]);

  return {
    cartItems,
    getQty,
    adjustQty,
    removeFromCart,
    quote,
    totalSeats: countSeats(lines),
    ready,
  };
}
