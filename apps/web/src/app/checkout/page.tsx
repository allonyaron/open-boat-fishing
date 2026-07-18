import { db } from "@/lib/db";
import { operators } from "@openboat/db";
import { CheckoutClient } from "./CheckoutClient";

export default async function CheckoutPage() {
  const [operator] = await db.select({ name: operators.name }).from(operators).limit(1);
  const operatorName = operator?.name ?? "Fishing Charter";

  return <CheckoutClient operatorName={operatorName} />;
}
