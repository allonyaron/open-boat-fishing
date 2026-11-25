import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireMate } from "@/lib/mate-auth";
import { InventoryError, setTripCapacity } from "@/lib/inventory/seats";
import { requestContext } from "@/lib/request-context";

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ tripId: string }> }) {
  const auth = await requireMate(req);
  if (auth instanceof NextResponse) return auth;
  const { staff } = auth;
  // The mate on the boat is the actor (row 12).
  const ctx = requestContext(req, {
    kind: "staff",
    staffId: staff.staffId,
    operatorId: staff.operatorId,
    role: staff.role === "admin" ? "admin" : "mate",
  });

  const { tripId } = await params;
  const body = (await req.json().catch(() => ({}))) as { capacity?: unknown };

  const newCapacity = Number(body.capacity);
  if (!Number.isInteger(newCapacity) || newCapacity < 1) {
    return NextResponse.json({ error: "capacity must be a positive integer" }, { status: 400 });
  }

  let responseData: {
    capacity: number;
    seatsRemaining: number;
    certificateCapacity: number | null;
    ticketsSold: number;
  } | null = null;

  try {
    await db.transaction(async (tx) => {
      // The inventory module enforces the certificate capacity (required from
      // the boat), the floor of seats already taken, and writes the ledger row.
      const result = await setTripCapacity(tx, ctx, {
        operatorId: staff.operatorId,
        tripId,
        capacity: newCapacity,
        requireCertificate: true,
      });
      responseData = {
        capacity: result.capacity,
        seatsRemaining: result.seatsRemaining,
        certificateCapacity: result.certificateCapacity,
        ticketsSold: result.sold,
      };
    });
  } catch (err: unknown) {
    if (err instanceof InventoryError) {
      return NextResponse.json({ error: err.message }, { status: err.httpStatus });
    }
    throw err;
  }

  // TODO: fire standby notifications when capacity increases (item 26)

  return NextResponse.json(responseData!);
}
