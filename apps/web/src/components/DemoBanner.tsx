import { env } from "@/lib/env";
import { DemoTab } from "./DemoTab";

export function DemoBanner() {
  if (env.DEMO_MODE !== "true") return null;
  return <DemoTab />;
}
