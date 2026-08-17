import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { NextRequest } from "next/server";
import { POST } from "@/app/api/mate/checkins/route";
import { seedOperator, cleanupOperator, seedBooking } from "../db-helpers";

let ctx: Awaited<ReturnType<typeof seedOperator>>;
let ticketId: string;

beforeAll(async () => {
  ctx = await seedOperator();
  const booking = await seedBooking(ctx, { status: "confirmed" });
  ticketId = booking.ticketId;
});

afterAll(async () => {
  await cleanupOperator(ctx.operatorId);
});

function req(body: unknown, token?: string) {
  return new NextRequest("http://localhost/api/mate/checkins", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
}

describe("POST /api/mate/checkins", () => {
  it("returns 401 without auth", async () => {
    const res = await POST(req({ events: [] }));
    expect(res.status).toBe(401);
  });

  it("returns empty results for empty events array", async () => {
    const res = await POST(req({ events: [] }, ctx.mateToken));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.results).toHaveLength(0);
  });

  it("returns ok:true for a valid check-in event", async () => {
    const res = await POST(
      req(
        {
          events: [
            {
              localId: "local-1",
              ticketId,
              tripId: ctx.tripId,
              method: "qr",
              note: null,
              checkedInAt: new Date().toISOString(),
            },
          ],
        },
        ctx.mateToken,
      ),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.results).toHaveLength(1);
    expect(body.results[0].ok).toBe(true);
    expect(body.results[0].localId).toBe("local-1");
  });

  it("returns ticket_not_found for unknown ticket ID", async () => {
    const res = await POST(
      req(
        {
          events: [
            {
              localId: "local-2",
              ticketId: "00000000-0000-0000-0000-000000000000",
              tripId: ctx.tripId,
              method: "qr",
              note: null,
              checkedInAt: new Date().toISOString(),
            },
          ],
        },
        ctx.mateToken,
      ),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.results[0].ok).toBe(false);
    expect(body.results[0].error).toBe("ticket_not_found");
  });

  it("returns invalid_event for malformed event", async () => {
    const res = await POST(
      req(
        {
          events: [{ localId: "local-3" }], // missing required fields
        },
        ctx.mateToken,
      ),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.results[0].ok).toBe(false);
    expect(body.results[0].error).toBe("invalid_event");
  });
});
