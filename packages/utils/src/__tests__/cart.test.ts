import { describe, it, expect } from "vitest";
import {
  type CartLine,
  type CartTrip,
  CART_MAX_AGE_MS,
  adjustQuantity,
  cartKey,
  cartMonths,
  lineFares,
  parseStoredCart,
  reconcileCart,
  removeTrip,
  serializeCart,
  setQuantity,
  toApiCart,
  totalSeats,
} from "../cart";

function trip(id: string, over: Partial<CartTrip> = {}): CartTrip {
  return {
    id,
    departureDate: "2026-11-02",
    seatsRemaining: 10,
    product: {
      prices: [
        { ticketType: "adult", priceCents: 5500 },
        { ticketType: "child", priceCents: 3500 },
      ],
    },
    ...over,
  };
}

describe("setQuantity / adjustQuantity", () => {
  it("adds, updates and removes fares and lines", () => {
    let lines: CartLine[] = [];
    lines = adjustQuantity(lines, trip("t1"), "adult", 1);
    lines = adjustQuantity(lines, trip("t1"), "adult", 1);
    lines = adjustQuantity(lines, trip("t1"), "child", 1);
    expect(lines).toEqual([{ trip: trip("t1"), quantities: { adult: 2, child: 1 } }]);
    lines = setQuantity(lines, trip("t1"), "child", 0);
    expect(lines[0].quantities).toEqual({ adult: 2 });
    lines = adjustQuantity(lines, trip("t1"), "adult", -2);
    expect(lines).toEqual([]);
  });

  it("caps a trip's fares together at its seats", () => {
    const small = trip("t1", { seatsRemaining: 3 });
    let lines = setQuantity([], small, "adult", 2);
    lines = setQuantity(lines, small, "child", 5);
    expect(lines[0].quantities).toEqual({ adult: 2, child: 1 });
    lines = adjustQuantity(lines, small, "adult", 1);
    expect(lines[0].quantities).toEqual({ adult: 2, child: 1 });
  });

  it("refreshes the trip snapshot and keeps line order", () => {
    let lines = setQuantity([], trip("t1"), "adult", 1);
    lines = setQuantity(lines, trip("t2"), "adult", 1);
    lines = setQuantity(lines, trip("t1", { seatsRemaining: 4 }), "adult", 2);
    expect(lines.map((l) => l.trip.id)).toEqual(["t1", "t2"]);
    expect(lines[0].trip.seatsRemaining).toBe(4);
    expect(removeTrip(lines, "t1").map((l) => l.trip.id)).toEqual(["t2"]);
  });
});

describe("toApiCart / cartKey / lineFares", () => {
  const lines: CartLine[] = [
    { trip: trip("t2"), quantities: { child: 1, adult: 2 } },
    { trip: trip("t1"), quantities: { adult: 1 } },
  ];

  it("lists fares in the trip's order with their snapshot price", () => {
    expect(lineFares(lines[0])).toEqual([
      { ticketType: "adult", quantity: 2, priceCents: 5500 },
      { ticketType: "child", quantity: 1, priceCents: 3500 },
    ]);
    expect(toApiCart(lines)).toEqual([
      { tripId: "t2", tickets: [{ ticketType: "adult", quantity: 2 }, { ticketType: "child", quantity: 1 }] },
      { tripId: "t1", tickets: [{ ticketType: "adult", quantity: 1 }] },
    ]);
  });

  it("keys the cart by content, not order, in the format stored holds use", () => {
    expect(cartKey(lines)).toBe("t1:adult:1,t2:adult:2,t2:child:1");
    expect(cartKey([...lines].reverse())).toBe(cartKey(lines));
  });

  it("lists the months the cart departs in", () => {
    expect(cartMonths([...lines, { trip: trip("t3", { departureDate: "2026-12-01" }), quantities: { adult: 1 } }])).toEqual([
      "2026-11",
      "2026-12",
    ]);
    expect(totalSeats(lines)).toBe(4);
  });
});

describe("serializeCart / parseStoredCart", () => {
  const lines: CartLine[] = [{ trip: trip("t1"), quantities: { adult: 2 } }];
  const now = 1_800_000_000_000;

  it("round-trips a cart", () => {
    expect(parseStoredCart(serializeCart(lines, now), now + 1000)).toEqual(lines);
  });

  it("drops a cart older than a day", () => {
    expect(parseStoredCart(serializeCart(lines, now), now + CART_MAX_AGE_MS + 1)).toEqual([]);
  });

  it("drops the pre-store array format and anything unreadable", () => {
    const old = JSON.stringify([{ tripId: "t1", tickets: [{ ticketType: "adult", quantity: 1, priceCents: 5500 }] }]);
    expect(parseStoredCart(old, now)).toEqual([]);
    expect(parseStoredCart("{not json", now)).toEqual([]);
    expect(parseStoredCart(null, now)).toEqual([]);
  });
});

describe("reconcileCart", () => {
  const NOV = ["2026-11"];

  it("keeps an unchanged cart as is", () => {
    const lines: CartLine[] = [{ trip: trip("t1"), quantities: { adult: 2 } }];
    expect(reconcileCart(lines, [trip("t1")], NOV)).toEqual({ lines, changed: false });
  });

  it("takes fresh prices and seats, and says so", () => {
    const lines: CartLine[] = [{ trip: trip("t1"), quantities: { adult: 2 } }];
    const fresh = trip("t1", {
      seatsRemaining: 7,
      product: { prices: [{ ticketType: "adult", priceCents: 6000 }, { ticketType: "child", priceCents: 3500 }] },
    });
    const result = reconcileCart(lines, [fresh], NOV);
    expect(result.changed).toBe(true);
    expect(result.lines[0].trip).toBe(fresh);
  });

  it("drops trips no longer listed and fares no longer sold", () => {
    const lines: CartLine[] = [
      { trip: trip("gone"), quantities: { adult: 1 } },
      { trip: trip("t1"), quantities: { adult: 3, child: 2 } },
      { trip: trip("t2"), quantities: { child: 1 } },
    ];
    const result = reconcileCart(
      lines,
      [trip("t1"), trip("t2", { product: { prices: [{ ticketType: "adult", priceCents: 5500 }] } })],
      NOV,
    );
    expect(result.changed).toBe(true);
    expect(result.lines.map((l) => [l.trip.id, l.quantities])).toEqual([["t1", { adult: 3, child: 2 }]]);
  });

  it("doesn't cut quantities to the listed seats (the listing counts the customer's own hold)", () => {
    const lines: CartLine[] = [{ trip: trip("t1"), quantities: { adult: 6 } }];
    const result = reconcileCart(lines, [trip("t1", { seatsRemaining: 4 })], NOV);
    expect(result.lines[0].quantities).toEqual({ adult: 6 });
    expect(cartKey(result.lines)).toBe(cartKey(lines));
  });

  it("leaves lines in months it didn't fetch alone", () => {
    const october = trip("oct", { departureDate: "2026-10-20" });
    const lines: CartLine[] = [
      { trip: trip("t1"), quantities: { adult: 1 } },
      { trip: october, quantities: { adult: 1 } },
    ];
    const result = reconcileCart(lines, [trip("t1")], NOV);
    expect(result.lines.map((l) => l.trip.id)).toEqual(["t1", "oct"]);
    expect(result.changed).toBe(false);
  });
});
