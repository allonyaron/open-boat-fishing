import { CheckoutClient } from "./CheckoutClient";
import { getOperatorRecord } from "@/lib/operator";

export default async function CheckoutPage() {
  const operator = await getOperatorRecord();
  const operatorName = operator?.name ?? "Fishing Charter";

  return <CheckoutClient operatorName={operatorName} />;
}
