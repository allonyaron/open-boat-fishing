import { NextRequest, NextResponse } from "next/server";
import { Expo } from "expo-server-sdk";
import { db } from "@/lib/db";
import { operators, pushTokens } from "@openboat/db";
import { and, eq } from "drizzle-orm";

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({})) as {
    expoToken?: string;
    customerEmail?: string;
    customerId?: string;
    notifyReminders?: boolean;
    notifyCancellations?: boolean;
    notifyConfirmations?: boolean;
  };

  const { expoToken, customerEmail, customerId } = body;

  if (!expoToken || !Expo.isExpoPushToken(expoToken)) {
    return NextResponse.json({ error: "Invalid Expo push token" }, { status: 400 });
  }

  const [operator] = await db.select({ id: operators.id }).from(operators).limit(1);
  if (!operator) return NextResponse.json({ error: "No operator" }, { status: 500 });

  await db
    .insert(pushTokens)
    .values({
      operatorId: operator.id,
      expoToken,
      customerId: customerId ?? null,
      customerEmail: customerEmail?.toLowerCase().trim() ?? null,
      notifyReminders: body.notifyReminders ?? true,
      notifyCancellations: body.notifyCancellations ?? true,
      notifyConfirmations: body.notifyConfirmations ?? true,
    })
    .onConflictDoUpdate({
      target: [pushTokens.operatorId, pushTokens.expoToken],
      set: {
        customerId: customerId ?? undefined,
        customerEmail: customerEmail?.toLowerCase().trim() ?? undefined,
        active: true,
        ...(body.notifyReminders !== undefined && { notifyReminders: body.notifyReminders }),
        ...(body.notifyCancellations !== undefined && { notifyCancellations: body.notifyCancellations }),
        ...(body.notifyConfirmations !== undefined && { notifyConfirmations: body.notifyConfirmations }),
        updatedAt: new Date(),
      },
    });

  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const expoToken = searchParams.get("token");
  if (!expoToken) return NextResponse.json({ error: "Missing token" }, { status: 400 });

  const [operator] = await db.select({ id: operators.id }).from(operators).limit(1);
  if (!operator) return NextResponse.json({ error: "No operator" }, { status: 500 });

  await db
    .update(pushTokens)
    .set({ active: false, updatedAt: new Date() })
    .where(and(eq(pushTokens.operatorId, operator.id), eq(pushTokens.expoToken, expoToken)));

  return NextResponse.json({ ok: true });
}
