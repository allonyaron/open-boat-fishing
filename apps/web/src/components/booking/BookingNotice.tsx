import type { ReactNode } from "react";
import { BookingNav } from "@/components/BookingCalendar";

// A full-page message in place of a booking: locked, expired, cancelled or
// unpaid. Same layout as the processing screen.
export function BookingNotice({
  operatorName,
  dockAddress,
  phone,
  eyebrow,
  heading,
  children,
  action,
}: {
  operatorName: string;
  dockAddress: string | null;
  phone: string | null;
  eyebrow: string;
  heading: string;
  children: ReactNode;
  action?: { href: string; label: string };
}) {
  return (
    <div className="min-h-screen bg-deck font-archivo">
      <BookingNav operatorName={operatorName} dockAddress={dockAddress} phone={phone} step={3} />
      <div
        className="flex flex-col items-center justify-center gap-4 text-center font-archivo"
        style={{ minHeight: 620, padding: "40px 24px" }}
      >
        <div className="font-plex-mono font-semibold" style={{ fontSize: 12, letterSpacing: ".18em", color: "#5b6f79" }}>
          {eyebrow}
        </div>
        <h1
          className="font-archivo font-bold uppercase leading-none"
          style={{ fontSize: 34, letterSpacing: "-.02em", color: "#16354a" }}
        >
          {heading}
        </h1>
        <div className="font-archivo" style={{ fontSize: 17, lineHeight: 1.5, color: "#41565f", maxWidth: "34ch" }}>
          {children}
          {phone && <> Questions? Call {phone}.</>}
        </div>
        {action && (
          <a
            href={action.href}
            className="font-plex-mono font-semibold transition-colors hover:bg-[#e6ebeb]"
            style={{ fontSize: 12, letterSpacing: ".1em", border: "1px solid #16354a", color: "#16354a", padding: "16px 22px", textDecoration: "none" }}
          >
            {action.label}
          </a>
        )}
      </div>
    </div>
  );
}
