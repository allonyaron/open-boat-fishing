import { env } from "@/lib/env";
import SettingsClient from "./SettingsClient";

export default function SettingsPage() {
  return <SettingsClient demoMode={env.DEMO_MODE === "true"} />;
}
