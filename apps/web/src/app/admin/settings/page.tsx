import Link from "next/link";
import { env } from "@/lib/env";
import { ClearDemoCustomers } from "@/components/admin/ClearDemoCustomers";

function BuildingIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <path d="M9 22V12h6v10" />
      <path d="M3 9h18" />
    </svg>
  );
}

function VesselIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 17l2-8h14l2 8" />
      <path d="M5 17a7 7 0 0 0 14 0" />
      <path d="M12 9V4" />
      <path d="M9 4h6" />
    </svg>
  );
}

function FishingIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <path d="M18 16.5a4 4 0 0 0-4-4H6l-3 3 3 3h8a4 4 0 0 0 4-4z" />
      <path d="M22 12c0-5-4-9-9-9" />
      <path d="M18 8l4-4-4-4" />
      <circle cx="7" cy="16.5" r="1" fill="currentColor" />
    </svg>
  );
}

function CalendarIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="4" width="18" height="18" rx="2" />
      <line x1="16" y1="2" x2="16" y2="6" />
      <line x1="8" y1="2" x2="8" y2="6" />
      <line x1="3" y1="10" x2="21" y2="10" />
    </svg>
  );
}

function StaffIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  );
}

function ChevronIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="9 18 15 12 9 6" />
    </svg>
  );
}

const sections = [
  {
    href: "/admin/settings/operator",
    title: "Business Info",
    description: "Name, dock address, phone, email, and cancellation policy.",
    Icon: BuildingIcon,
  },
  {
    href: "/admin/settings/vessels",
    title: "Vessels",
    description: "Add and manage your boats — capacity, color, and group discounts.",
    Icon: VesselIcon,
  },
  {
    href: "/admin/settings/products",
    title: "Trip Types & Pricing",
    description: "Define trip categories per vessel and set ticket prices.",
    Icon: FishingIcon,
  },
  {
    href: "/admin/settings/schedules",
    title: "Schedules",
    description: "Set recurring trip patterns by day of week. Trips generate automatically.",
    Icon: CalendarIcon,
  },
  {
    href: "/admin/settings/staff",
    title: "Staff",
    description: "Manage admin accounts (password) and mate accounts (PIN).",
    Icon: StaffIcon,
  },
];

export default function SettingsPage() {
  return (
    <div className="max-w-3xl mx-auto">
      <div className="mb-6">
        <h1 className="text-xl font-semibold text-ink">Settings</h1>
        <p className="text-sm text-muted mt-0.5">Configure your operation</p>
      </div>

      {/* 1 col on mobile, 2 col on sm+ */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {sections.map(({ href, title, description, Icon }) => (
          <Link
            key={href}
            href={href}
            className="flex flex-col gap-4 bg-white rounded-xl border border-hairline p-5 hover:border-navy/30 hover:shadow-card transition-all group"
          >
            <div className="flex items-start justify-between">
              <div className="w-11 h-11 rounded-icon bg-navy-tint flex items-center justify-center flex-shrink-0 text-navy group-hover:bg-navy group-hover:text-white transition-colors">
                <Icon />
              </div>
              <div className="text-faint group-hover:text-navy transition-colors">
                <ChevronIcon />
              </div>
            </div>
            <div>
              <div className="text-sm font-semibold text-ink mb-1">{title}</div>
              <div className="text-xs text-muted leading-relaxed">{description}</div>
            </div>
          </Link>
        ))}
      </div>

      {env.DEMO_MODE === "true" && (
        <div className="mt-6">
          <ClearDemoCustomers />
        </div>
      )}
    </div>
  );
}
