import { describe, expect, it } from "vitest";
import { BOARDING_WINDOW_MINUTES, ticketLightKind, tripLightKind } from "@/components/admin/merchant/StatusLight";

const DEPARTS = "2026-10-24T11:00:00.000Z"; // 7:00 AM ET
const at = (minutesFromDeparture: number) => new Date(DEPARTS).getTime() + minutesFromDeparture * 60_000;

const trip = (over: Partial<Parameters<typeof tripLightKind>[0]> = {}) => ({
  status: "scheduled",
  scheduleId: "sched-1",
  capacity: 60,
  ticketsSold: 20,
  startTime: DEPARTS,
  ...over,
});

describe("tripLightKind — seat states", () => {
  it("on sale below 70%", () => expect(tripLightKind(trip())).toBe("on-sale"));
  it("filling up at 70%", () => expect(tripLightKind(trip({ ticketsSold: 42 }))).toBe("filling-up"));
  it("sold out when full", () => expect(tripLightKind(trip({ ticketsSold: 60 }))).toBe("sold-out"));
  it("added for a one-off, ahead of filling up", () =>
    expect(tripLightKind(trip({ scheduleId: null, ticketsSold: 50 }))).toBe("added"));
  it("sold out beats added", () => expect(tripLightKind(trip({ scheduleId: null, ticketsSold: 60 }))).toBe("sold-out"));
  it("an unknown scheduleId never reads as added", () =>
    expect(tripLightKind(trip({ scheduleId: undefined }))).toBe("on-sale"));
  it("cancelled wins over everything", () =>
    expect(tripLightKind(trip({ status: "cancelled", ticketsSold: 60 }), at(10))).toBe("cancelled"));
});

describe("tripLightKind — clock states", () => {
  it("no clock, no clock states", () => expect(tripLightKind(trip({ ticketsSold: 60 }))).toBe("sold-out"));
  it("before the boarding window it keeps its seat state", () =>
    expect(tripLightKind(trip(), at(-BOARDING_WINDOW_MINUTES - 1))).toBe("on-sale"));
  it(`boarding now from ${BOARDING_WINDOW_MINUTES} minutes before departure`, () => {
    expect(tripLightKind(trip(), at(-BOARDING_WINDOW_MINUTES))).toBe("boarding");
    expect(tripLightKind(trip({ ticketsSold: 60 }), at(-1))).toBe("boarding");
  });
  it("departed once the departure time has passed, even when full", () => {
    expect(tripLightKind(trip(), at(0))).toBe("departed");
    expect(tripLightKind(trip({ ticketsSold: 60 }), at(90))).toBe("departed");
  });
  it("departed when the server already marks it sailed", () => {
    expect(tripLightKind(trip({ status: "sailed" }))).toBe("departed");
    expect(tripLightKind(trip({ status: "pending_settlement" }), at(-60))).toBe("departed");
  });
});

describe("ticketLightKind", () => {
  it("refunded wins", () => expect(ticketLightKind({ voided: true, checkedIn: true })).toBe("refunded"));
  it("aboard", () => expect(ticketLightKind({ voided: false, checkedIn: true })).toBe("aboard"));
  it("not here yet", () => expect(ticketLightKind({ voided: false, checkedIn: false })).toBe("not-here"));
});
