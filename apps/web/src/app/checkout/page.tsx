import { db } from "@/lib/db";
import { operators } from "@openboat/db";
import { eq } from "drizzle-orm";
import { CheckoutClient } from "./CheckoutClient";
import { getOperatorIdFromHeaders } from "@/lib/operator";

export default async function CheckoutPage() {
  const operatorId = await getOperatorIdFromHeaders();
  const [operator] = operatorId
    ? await db.select({ name: operators.name }).from(operators).where(eq(operators.id, operatorId))
    : [];
  const operatorName = operator?.name ?? "Fishing Charter";

  return <CheckoutClient operatorName={operatorName} />;
}
