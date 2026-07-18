import { db } from "@/lib/db";
import { operators } from "@openboat/db";
import { CartClient } from "./CartClient";

export default async function CartPage({
  searchParams,
}: {
  searchParams: { data?: string };
}) {
  const [operator] = await db.select({ name: operators.name }).from(operators).limit(1);
  const operatorName = operator?.name ?? "Fishing Charter";
  return <CartClient operatorName={operatorName} rawData={searchParams.data ?? ""} />;
}
