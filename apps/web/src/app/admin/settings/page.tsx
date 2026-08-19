"use client";

import Link from "next/link";

const sections = [
  {
    href: "/admin/settings/operator",
    title: "Business Info",
    description: "Name, dock address, phone, email, cancellation window, and fee settings.",
    icon: "🏢",
  },
  {
    href: "/admin/settings/vessels",
    title: "Vessels",
    description: "Add and manage your boats — capacity, color coding, and group discounts.",
    icon: "🚢",
  },
  {
    href: "/admin/settings/products",
    title: "Trip Types & Pricing",
    description: "Define trip categories per vessel (Sea Bass, Fluke, etc.) and set ticket prices.",
    icon: "🎣",
  },
  {
    href: "/admin/settings/schedules",
    title: "Schedules",
    description: "Set recurring trip patterns by day of week. Trips are generated automatically on save.",
    icon: "📅",
  },
  {
    href: "/admin/settings/staff",
    title: "Staff",
    description: "Create admin accounts (password login) and mate accounts (PIN login).",
    icon: "👥",
  },
];

export default function SettingsPage() {
  return (
    <div className="max-w-3xl mx-auto">
      <h1 className="text-2xl font-semibold text-gray-900 mb-6">Settings</h1>
      <div className="grid gap-4">
        {sections.map((s) => (
          <Link
            key={s.href}
            href={s.href}
            className="flex items-start gap-4 bg-white rounded-xl border border-gray-200 px-6 py-5 hover:border-blue-300 hover:shadow-sm transition-all"
          >
            <span className="text-2xl mt-0.5">{s.icon}</span>
            <div>
              <div className="font-medium text-gray-900">{s.title}</div>
              <div className="text-sm text-gray-500 mt-0.5">{s.description}</div>
            </div>
            <span className="ml-auto text-gray-300 text-lg self-center">›</span>
          </Link>
        ))}
      </div>
    </div>
  );
}
