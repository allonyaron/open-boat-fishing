import { describe, it, expect, vi } from "vitest";
import {
  PLATFORM_FEE_CENTS,
  type CartInput,
  type PriceBook,
  type PricingTrip,
  PricingError,
  priceCart,
  resolveTripPrices,
} from "@/lib/bookings/price-cart";

const VESSEL_A = "vessel-a";
const VESSEL_B = "vessel-b";

function trip(id: string, over: Partial<PricingTrip> = {}): PricingTrip {
  return { id, vesselId: VESSEL_A, productId: "product-1", scheduleId: "schedule-1", ...over };
}

function book(over: Partial<PriceBook> = {}): PriceBook {
  return {
    productPrices: [
      { productId: "product-1", ticketType: "adult", priceCents: 6800 },
      { productId: "product-1", ticketType: "child", priceCents: 4000 },
      { productId: "product-2", ticketType: "adult", priceCents: 4950 },
    ],
    schedulePrices: [],
    vessels: [
      { id: VESSEL_A, groupDiscountThreshold: null, groupDiscountPct: null },
      { id: VESSEL_B, groupDiscountThreshold: null, groupDiscountPct: null },
    ],
    ...over,
  };
}

function withDiscount(threshold: number | null, pct: number | null, vesselId = VESSEL_A): PriceBook {
  const b = book();
  b.vessels = b.vessels.map((v) => (v.id === vesselId ? { ...v, groupDiscountThreshold: threshold, groupDiscountPct: pct } : v));
  return b;
}

function nets(cart: ReturnType<typeof priceCart>) {
  return cart.lines.flatMap((l) => l.tickets.map((t) => t.netCents));
}

describe("priceCart", () => {
  it("charges the list price with no discount", () => {
    const priced = priceCart(
      [{ tripId: "t1", tickets: [{ ticketType: "adult", quantity: 2 }, { ticketType: "child", quantity: 1 }] }],
      [trip("t1")],
      book(),
    );
    expect(priced.totalCents).toBe(2 * 6800 + 4000);
    expect(priced.listCents).toBe(priced.totalCents);
    expect(priced.discountCents).toBe(0);
    expect(priced.ticketCount).toBe(3);
    expect(priced.feeCents).toBe(3 * PLATFORM_FEE_CENTS);
    expect(priced.lines[0].fares).toEqual([
      { ticketType: "adult", quantity: 2, unitListCents: 6800, listCents: 13600 },
      { ticketType: "child", quantity: 1, unitListCents: 4000, listCents: 4000 },
    ]);
    expect(nets(priced)).toEqual([6800, 6800, 4000]);
  });

  it("prices a $49.50 fare in cents", () => {
    const priced = priceCart(
      [{ tripId: "t1", tickets: [{ ticketType: "adult", quantity: 3 }] }],
      [trip("t1", { productId: "product-2" })],
      book(),
    );
    expect(priced.totalCents).toBe(14850);
  });

  it("applies a group discount once the vessel's threshold is met", () => {
    const b = withDiscount(10, 10);
    const below = priceCart([{ tripId: "t1", tickets: [{ ticketType: "adult", quantity: 9 }] }], [trip("t1")], b);
    expect(below.discountCents).toBe(0);

    const at = priceCart([{ tripId: "t1", tickets: [{ ticketType: "adult", quantity: 10 }] }], [trip("t1")], b);
    expect(at.listCents).toBe(68000);
    expect(at.discountCents).toBe(6800);
    expect(at.totalCents).toBe(61200);
    expect(nets(at)).toEqual(Array(10).fill(6120));
    expect(at.lines[0].discountCents).toBe(6800);
    expect(at.lines[0].netCents).toBe(61200);
  });

  it("allocates the discount's leftover cents so nets sum to the total (no penny drift)", () => {
    const b = book({
      productPrices: [{ productId: "product-1", ticketType: "adult", priceCents: 3333 }],
      vessels: [{ id: VESSEL_A, groupDiscountThreshold: 2, groupDiscountPct: 10 }],
    });
    const priced = priceCart([{ tripId: "t1", tickets: [{ ticketType: "adult", quantity: 3 }] }], [trip("t1")], b);
    // 10% of $99.99 rounds to $10.00, which doesn't split evenly three ways.
    expect(priced.discountCents).toBe(1000);
    expect(nets(priced).sort()).toEqual([2999, 3000, 3000]);
    expect(nets(priced).reduce((s, n) => s + n, 0)).toBe(priced.totalCents);
  });

  it("splits a vessel's discount across trips and fares by list price", () => {
    const b = withDiscount(4, 10);
    const priced = priceCart(
      [
        { tripId: "t1", tickets: [{ ticketType: "adult", quantity: 2 }] },
        { tripId: "t2", tickets: [{ ticketType: "adult", quantity: 1 }, { ticketType: "child", quantity: 1 }] },
      ],
      [trip("t1"), trip("t2", { scheduleId: "schedule-2" })],
      b,
    );
    // 4 tickets on vessel A meet the threshold only together.
    expect(priced.listCents).toBe(3 * 6800 + 4000);
    expect(priced.discountCents).toBe(Math.round(24400 * 0.1));
    const [l1, l2] = priced.lines;
    expect(l1.tripId).toBe("t1");
    expect(l1.discountCents).toBe(1360);
    expect(l2.discountCents).toBe(680 + 400);
    expect(l1.netCents + l2.netCents).toBe(priced.totalCents);
  });

  it("discounts only the vessel whose threshold is met", () => {
    const b = withDiscount(2, 10, VESSEL_A);
    const priced = priceCart(
      [
        { tripId: "t1", tickets: [{ ticketType: "adult", quantity: 2 }] },
        { tripId: "t2", tickets: [{ ticketType: "adult", quantity: 2 }] },
      ],
      [trip("t1"), trip("t2", { vesselId: VESSEL_B })],
      b,
    );
    expect(priced.lines.find((l) => l.tripId === "t1")!.discountCents).toBe(1360);
    expect(priced.lines.find((l) => l.tripId === "t2")!.discountCents).toBe(0);
    expect(priced.totalCents).toBe(4 * 6800 - 1360);
  });

  it("uses the schedule's price over the product's", () => {
    const b = book({
      schedulePrices: [{ scheduleId: "schedule-1", ticketType: "adult", priceCents: 7500 }],
    });
    const priced = priceCart(
      [
        { tripId: "t1", tickets: [{ ticketType: "adult", quantity: 1 }, { ticketType: "child", quantity: 1 }] },
        { tripId: "t2", tickets: [{ ticketType: "adult", quantity: 1 }] },
      ],
      [trip("t1"), trip("t2", { scheduleId: null })],
      b,
    );
    expect(priced.lines.find((l) => l.tripId === "t1")!.fares.map((f) => f.unitListCents)).toEqual([7500, 4000]);
    expect(priced.lines.find((l) => l.tripId === "t2")!.fares[0].unitListCents).toBe(6800);
  });

  it("returns the same result whatever order the cart is in", () => {
    const b = withDiscount(3, 15);
    const trips = [trip("t1"), trip("t2", { scheduleId: "schedule-2" })];
    const cart: CartInput = [
      { tripId: "t2", tickets: [{ ticketType: "child", quantity: 2 }, { ticketType: "adult", quantity: 1 }] },
      { tripId: "t1", tickets: [{ ticketType: "adult", quantity: 1 }] },
    ];
    const reversed: CartInput = [...cart].reverse().map((i) => ({ ...i, tickets: [...i.tickets].reverse() }));
    expect(priceCart(cart, trips, b)).toEqual(priceCart(reversed, trips, b));
  });

  it.each([
    ["a percentage over the ceiling", 2, 51],
    ["a 150% discount", 2, 150],
    ["a negative percentage (a surcharge)", 2, -10],
    ["a zero percentage", 2, 0],
    ["a fractional percentage", 2, 15.5],
    ["a threshold of 1", 1, 10],
    ["a threshold of 0", 0, 10],
    ["a threshold without a percentage", 2, null],
    ["a percentage without a threshold", null, 10],
  ])("ignores %s", (_label, threshold, pct) => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const priced = priceCart(
      [{ tripId: "t1", tickets: [{ ticketType: "adult", quantity: 4 }] }],
      [trip("t1")],
      withDiscount(threshold, pct),
    );
    expect(priced.totalCents).toBe(4 * 6800);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("refuses a total the platform fee would exceed", () => {
    const b = book({ productPrices: [{ productId: "product-1", ticketType: "adult", priceCents: 100 }] });
    expect(() => priceCart([{ tripId: "t1", tickets: [{ ticketType: "adult", quantity: 1 }] }], [trip("t1")], b)).toThrow(
      expect.objectContaining({ httpStatus: 422 }),
    );
  });

  it("refuses a fare or trip it can't price", () => {
    expect(() =>
      priceCart([{ tripId: "t1", tickets: [{ ticketType: "senior", quantity: 1 }] }], [trip("t1")], book()),
    ).toThrow(PricingError);
    expect(() =>
      priceCart([{ tripId: "missing", tickets: [{ ticketType: "adult", quantity: 1 }] }], [trip("t1")], book()),
    ).toThrow(expect.objectContaining({ httpStatus: 400 }));
  });

  // The total must not move: it is what Stripe charges. This is the formula
  // POST /api/bookings used before priceCart.
  it("charges what the previous inline formula charged", () => {
    function oldTotal(cart: CartInput, trips: PricingTrip[], b: PriceBook) {
      const find = (t: PricingTrip, type: string) =>
        (b.schedulePrices.find((p) => p.scheduleId === t.scheduleId && p.ticketType === type) ??
          b.productPrices.find((p) => p.productId === t.productId && p.ticketType === type))!.priceCents;
      let total = 0;
      const byVessel: Record<string, number> = {};
      for (const item of cart) {
        const t = trips.find((x) => x.id === item.tripId)!;
        for (const k of item.tickets) {
          total += find(t, k.ticketType) * k.quantity;
          byVessel[t.vesselId] = (byVessel[t.vesselId] ?? 0) + k.quantity;
        }
      }
      for (const v of b.vessels) {
        if (!v.groupDiscountThreshold || !v.groupDiscountPct) continue;
        if ((byVessel[v.id] ?? 0) < v.groupDiscountThreshold) continue;
        let sub = 0;
        for (const item of cart) {
          const t = trips.find((x) => x.id === item.tripId)!;
          if (t.vesselId !== v.id) continue;
          for (const k of item.tickets) sub += find(t, k.ticketType) * k.quantity;
        }
        total -= Math.round((sub * v.groupDiscountPct) / 100);
      }
      return total;
    }

    const b = book({
      productPrices: [
        { productId: "product-1", ticketType: "adult", priceCents: 4950 },
        { productId: "product-1", ticketType: "child", priceCents: 3333 },
        { productId: "product-1", ticketType: "senior", priceCents: 4125 },
      ],
      schedulePrices: [{ scheduleId: "schedule-2", ticketType: "adult", priceCents: 5575 }],
      vessels: [
        { id: VESSEL_A, groupDiscountThreshold: 3, groupDiscountPct: 15 },
        { id: VESSEL_B, groupDiscountThreshold: 5, groupDiscountPct: 7 },
      ],
    });
    const trips = [
      trip("t1"),
      trip("t2", { scheduleId: "schedule-2" }),
      trip("t3", { vesselId: VESSEL_B }),
      trip("t4", { vesselId: VESSEL_B, scheduleId: "schedule-2" }),
    ];
    const types = ["adult", "child", "senior"];
    let seed = 7;
    const rand = (n: number) => {
      seed = (seed * 1103515245 + 12345) % 2 ** 31;
      return seed % n;
    };
    for (let run = 0; run < 200; run++) {
      const cart: CartInput = trips
        .filter(() => rand(2) === 0)
        .map((t) => ({
          tripId: t.id,
          tickets: types.filter(() => rand(2) === 0).map((ticketType) => ({ ticketType, quantity: 1 + rand(6) })),
        }))
        .filter((i) => i.tickets.length > 0);
      if (cart.length === 0) continue;
      const priced = priceCart(cart, trips, b);
      expect(priced.totalCents).toBe(oldTotal(cart, trips, b));
      expect(priced.lines.reduce((s, l) => s + l.netCents, 0)).toBe(priced.totalCents);
      expect(nets(priced).reduce((s, n) => s + n, 0)).toBe(priced.totalCents);
    }
  });
});

describe("resolveTripPrices", () => {
  it("applies schedule overrides and includes schedule-only fares", () => {
    const b = book({
      schedulePrices: [
        { scheduleId: "schedule-1", ticketType: "adult", priceCents: 7500 },
        { scheduleId: "schedule-1", ticketType: "senior", priceCents: 6000 },
        { scheduleId: "schedule-9", ticketType: "child", priceCents: 1 },
      ],
    });
    expect(resolveTripPrices(trip("t1"), b)).toEqual([
      { ticketType: "adult", priceCents: 7500 },
      { ticketType: "child", priceCents: 4000 },
      { ticketType: "senior", priceCents: 6000 },
    ]);
    expect(resolveTripPrices(trip("t2", { scheduleId: null }), b)).toEqual([
      { ticketType: "adult", priceCents: 6800 },
      { ticketType: "child", priceCents: 4000 },
    ]);
  });
});
