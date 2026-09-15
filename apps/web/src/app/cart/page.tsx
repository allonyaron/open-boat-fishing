import { CartClient } from "./CartClient";
import { getOperatorRecord } from "@/lib/operator";

export default async function CartPage() {
  const operator = await getOperatorRecord();
  return (
    <CartClient
      operatorName={operator?.name ?? "Fishing Charter"}
    />
  );
}
