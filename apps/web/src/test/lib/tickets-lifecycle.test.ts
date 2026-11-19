import { describe, it, expect } from "vitest";
import { moveTickets } from "@/lib/tickets/lifecycle";
import { isTicketLive } from "@/lib/tickets/status";

// The DB side of moveTickets is covered in test/api/ticket-lifecycle.test.ts.
describe("moveTickets", () => {
  const scope = { operatorId: "op", bookingId: "b" };

  it.each([
    ["voided", "live"],
    ["refunded", "live"],
    ["disputed", "held"],
    ["live", "held"],
    ["held", "refunded"],
  ] as const)("refuses %s -> %s before touching the database", async (from, to) => {
    await expect(moveTickets({} as never, scope, from, to)).rejects.toThrow(`from ${from} to ${to}`);
  });

  it("moves nothing for an empty ticket list", async () => {
    await expect(moveTickets({} as never, { operatorId: "op", ticketIds: [] }, "live", "refunded")).resolves.toEqual([]);
  });
});

describe("isTicketLive", () => {
  it("is live only with status live and voided false", () => {
    expect(isTicketLive({ status: "live", voided: false })).toBe(true);
    // Refunded by code deployed before status existed.
    expect(isTicketLive({ status: "live", voided: true })).toBe(false);
    expect(isTicketLive({ status: "held", voided: false })).toBe(false);
  });
});
