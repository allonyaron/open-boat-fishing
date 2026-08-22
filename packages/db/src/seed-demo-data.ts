// ─── Demo operator seed data — openboatfishing.com ───────────────────────────
// Powers the public demo + production sandbox deployment. Not intended as a
// starting point for real operators — for that, edit seed-data.ts.
//
// Vessels are fictional. Dock address is Captree State Park because that's
// where the party-boat fleet actually docks; nobody will be confused by it.

import type { OperatorSeed, DomainSeed, VesselSeed } from "./seed-data.js";

export const demoOperatorData: OperatorSeed & {
  phone: string;
  dockAddress: string;
  dockMapsUrl: string;
} = {
  name: "MV Open Boat",
  slug: "mv-open-boat",
  emailFrom: "hello@openboatfishing.com",
  emailDomain: "openboatfishing.com",
  phone: "(631) 555-0100",
  dockAddress: "Captree State Park, Babylon, NY 11702",
  dockMapsUrl: "https://maps.google.com/?q=Captree+State+Park",
};

export const demoDomainData: DomainSeed[] = [
  { domain: "openboatfishing.com", primary: true },
  { domain: "www.openboatfishing.com", primary: false },
];

export const demoFleetData: VesselSeed[] = [
  {
    name: "MV Open Boat I",
    slug: "open-boat-1",
    color: "#0B2545",
    capacity: 24,
    products: [
      {
        displayName: "Bay Fluke Half-Day",
        category: "Fluke",
        showRemaining: true,
        adult: 55,
        child: 35,
      },
      {
        displayName: "Bay Sea Bass",
        category: "Sea Bass",
        showRemaining: true,
        adult: 60,
        child: 40,
      },
    ],
  },
  {
    name: "MV Open Boat II",
    slug: "open-boat-2",
    color: "#0087A8",
    capacity: 32,
    products: [
      {
        displayName: "Full-Day Blackfish",
        category: "Blackfish",
        showRemaining: true,
        adult: 99,
        child: 99,
      },
      {
        displayName: "Full-Day Ocean Wreck",
        category: "Sea Bass",
        showRemaining: true,
        adult: 115,
        child: 115,
      },
    ],
  },
  {
    name: "MV Open Boat Nightfall",
    slug: "open-boat-nightfall",
    color: "#C99A3F",
    capacity: 28,
    products: [
      {
        displayName: "Night Bluefish",
        category: "Bluefish",
        showRemaining: true,
        adult: 65,
        child: 65,
      },
      {
        displayName: "Night Striped Bass",
        category: "Striped Bass",
        showRemaining: true,
        adult: 70,
        child: 70,
      },
    ],
  },
];
