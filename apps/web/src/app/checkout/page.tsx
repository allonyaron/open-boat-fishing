import { CheckoutClient } from "./CheckoutClient";
import { getOperatorRecord } from "@/lib/operator";

export default async function CheckoutPage() {
  const operator = await getOperatorRecord();
  return (
    <CheckoutClient
      operatorName={operator?.name ?? "Fishing Charter"}
      phone={operator?.phone ?? null}
      dockAddress={operator?.dockAddress ?? null}
    />
  );
}
