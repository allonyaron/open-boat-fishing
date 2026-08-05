import { Expo, type ExpoPushMessage } from "expo-server-sdk";
import { db } from "@/lib/db";
import { pushTokens } from "@openboat/db";
import { and, eq, inArray } from "drizzle-orm";

const expo = new Expo();

type PushFilter = "cancellations" | "reminders" | "confirmations";

async function getTokensForEmails(
  operatorId: string,
  emails: string[],
  filter: PushFilter
): Promise<string[]> {
  if (emails.length === 0) return [];
  const col =
    filter === "cancellations"
      ? pushTokens.notifyCancellations
      : filter === "reminders"
      ? pushTokens.notifyReminders
      : pushTokens.notifyConfirmations;

  const rows = await db
    .select({ token: pushTokens.expoToken })
    .from(pushTokens)
    .where(
      and(
        eq(pushTokens.operatorId, operatorId),
        eq(pushTokens.active, true),
        eq(col, true),
        inArray(pushTokens.customerEmail, emails)
      )
    );
  return rows.map((r) => r.token).filter(Expo.isExpoPushToken);
}

export async function sendPushToEmails(
  operatorId: string,
  emails: string[],
  message: Pick<ExpoPushMessage, "title" | "body" | "data">,
  filter: PushFilter
): Promise<void> {
  const tokens = await getTokensForEmails(operatorId, emails, filter);
  if (tokens.length === 0) return;

  const messages: ExpoPushMessage[] = tokens.map((to) => ({
    to,
    sound: "default",
    ...message,
  }));

  const chunks = expo.chunkPushNotifications(messages);
  await Promise.allSettled(chunks.map((chunk) => expo.sendPushNotificationsAsync(chunk)));
}

export async function sendPushToToken(
  token: string,
  message: Pick<ExpoPushMessage, "title" | "body" | "data">
): Promise<void> {
  if (!Expo.isExpoPushToken(token)) return;
  await expo.sendPushNotificationsAsync([{ to: token, sound: "default", ...message }]);
}
