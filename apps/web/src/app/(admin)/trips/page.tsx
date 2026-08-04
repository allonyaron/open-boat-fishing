import { redirect } from "next/navigation";

// Admin trips live at /admin/trips
export default function TripsRedirect() {
  redirect("/admin/trips");
}
