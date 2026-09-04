export const dynamic = "force-dynamic";

import { getOperatorRecord } from "@/lib/operator";
import { PublicNav } from "@/components/PublicNav";

export default async function PublicLayout({ children }: { children: React.ReactNode }) {
  const operator = await getOperatorRecord();
  return (
    <>
      <PublicNav
        operatorName={operator?.name ?? "Fishing Charter"}
        phone={operator?.phone ?? null}
      />
      {children}
    </>
  );
}
