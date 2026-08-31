import { NextRequest, NextResponse } from "next/server";
import { Expo } from "expo-server-sdk";
import { db } from "@/lib/db";
import { requireCustomer } from "@/lib/customer-auth";
import { pushTokens } from "@openboat/db";
import { and, eq } from "drizzle-orm";

export async function POST(req: NextRequest) {
  const auth = await requireCustomer(req);
  if (auth instanceof NextResponse) return auth;
  const { customer } = auth;

  // customerEmail and customerId come from the verified token — not trusted from the body.
  const body = (await req.json().catch(() => ({}))) as {
    expoToken?: string;
    notifyReminders?: boolean;
    notifyCancellations?: boolean;
    notifyConfirmations?: boolean;
  };

  const { expoToken } = body;

  if (!expoToken || !Expo.isExpoPushToken(expoToken)) {
    return NextResponse.json({ error: "Invalid Expo push token" }, { status: 400 });
  }

  // Use operatorId from the verified token, not the header — token is HMAC-signed
  // and can't be spoofed; the header is controlled by middleware but token is stronger.
  const operatorId = customer.operatorId;

  await db
    .insert(pushTokens)
    .values({
      operatorId,
      expoToken,
      customerId: customer.customerId,
      customerEmail: customer.email,
      notifyReminders: body.notifyReminders ?? true,
      notifyCancellations: body.notifyCancellations ?? true,
      notifyConfirmations: body.notifyConfirmations ?? true,
    })
    .onConflictDoUpdate({
      target: [pushTokens.operatorId, pushTokens.expoToken],
      set: {
        customerId: customer.customerId,
        customerEmail: customer.email,
        active: true,
        ...(body.notifyReminders !== undefined && { notifyReminders: body.notifyReminders }),
        ...(body.notifyCancellations !== undefined && {
          notifyCancellations: body.notifyCancellations,
        }),
        ...(body.notifyConfirmations !== undefined && {
          notifyConfirmations: body.notifyConfirmations,
        }),
        updatedAt: new Date(),
      },
    });

  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest) {
  const auth = await requireCustomer(req);
  if (auth instanceof NextResponse) return auth;
  const { customer } = auth;

  const { searchParams } = req.nextUrl;
  const expoToken = searchParams.get("token");
  if (!expoToken) return NextResponse.json({ error: "Missing token" }, { status: 400 });

  const operatorId = customer.operatorId;

  await db
    .update(pushTokens)
    .set({ active: false, updatedAt: new Date() })
    .where(
      and(
        eq(pushTokens.operatorId, operatorId),
        eq(pushTokens.expoToken, expoToken),
        eq(pushTokens.customerEmail, customer.email),
      ),
    );

  return NextResponse.json({ ok: true });
}
