import { redirect } from "next/navigation";

// Admin login lives at /admin/login
export default function LoginRedirect() {
  redirect("/admin/login");
}
