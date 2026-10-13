import { describe, expect, it } from "vitest";
import {
  SEATS_LOW_THRESHOLD,
  fmtDayShort,
  fmtLineTimeET,
  seatState,
  vesselShort,
} from "@/components/BookingCalendar/format";

const trip = (seatsRemaining: number, showRemaining = true) => ({
  seatsRemaining,
  product: { showRemaining },
});

describe("seatState (calendar lines and day panel)", () => {
  it("is open, with no count, above the threshold", () => {
    expect(seatState(trip(SEATS_LOW_THRESHOLD + 1))).toEqual({ kind: "open", count: null, label: "SEATS OPEN" });
  });

  it("is low with the count at 10 or fewer", () => {
    expect(seatState(trip(10))).toEqual({ kind: "low", count: "10", label: "10 SEATS LEFT" });
    expect(seatState(trip(8))).toEqual({ kind: "low", count: "8", label: "8 SEATS LEFT" });
    expect(seatState(trip(1))).toEqual({ kind: "low", count: "1", label: "1 SEAT LEFT" });
  });

  it("is low with no number when the product hides remaining seats", () => {
    expect(seatState(trip(8, false))).toEqual({ kind: "low", count: null, label: "ALMOST FULL" });
    expect(seatState(trip(30, false)).kind).toBe("open");
  });

  it("is full at zero, whatever showRemaining says", () => {
    expect(seatState(trip(0))).toEqual({ kind: "full", count: "FULL", label: "SOLD OUT" });
    expect(seatState(trip(0, false))).toEqual({ kind: "full", count: "FULL", label: "SOLD OUT" });
  });
});

describe("calendar formatting", () => {
  it("formats line start times in Eastern time", () => {
    expect(fmtLineTimeET("2026-11-14T10:00:00.000Z")).toBe("5:00A"); // EST
    expect(fmtLineTimeET("2026-11-14T17:30:00.000Z")).toBe("12:30P");
    expect(fmtLineTimeET("2026-07-04T10:00:00.000Z")).toBe("6:00A"); // EDT
  });

  it("formats a cart item's day", () => {
    expect(fmtDayShort("2026-11-01")).toBe("SUN NOV 1");
  });

  it("drops a vessel-type prefix", () => {
    expect(vesselShort("MV Open Boat II")).toBe("OPEN BOAT II");
    expect(vesselShort("M/V Nightfall")).toBe("NIGHTFALL");
    expect(vesselShort("Captree Princess")).toBe("CAPTREE PRINCESS");
  });
});
