import { redirect } from "next/navigation";
import type { BookingPageParams } from "@/lib/bookings/booking-page";

// The checkout's Stripe return_url before row 15. The confirmation page now
// takes the return itself; this forwards a return still in flight, keeping
// only what that page reads.
export default function DeliveryPage({ searchParams }: { searchParams: BookingPageParams }) {
  const kept = new URLSearchParams();
  for (const name of ["code", "k", "payment_intent", "payment_intent_client_secret"] as const) {
    const value = searchParams[name];
    if (typeof value === "string") kept.set(name, value);
  }
  redirect(`/booking/confirmation?${kept}`);
}
