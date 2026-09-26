import { getOperatorRecord } from "@/lib/operator";
import { LoginForm } from "./LoginForm";

export default async function AdminLoginPage() {
  const operator = await getOperatorRecord();

  return <LoginForm operatorName={operator?.name ?? null} />;
}
