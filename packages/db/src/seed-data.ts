// ─── Operator seed data ───────────────────────────────────────────────────────
// This file is the only file that changes when deploying for a new operator.
// Edit this, run `pnpm seed`, and the database is ready.
//
// When forking for a new operator:
//   1. Replace operatorData with the new operator's details
//   2. Replace fleetData with their boats and trip types
//   3. Replace domainData with their domains
//   4. Run `pnpm --filter @openboat/db seed`

export type ProductSeed = {
  displayName: string;
  category: string;
  showRemaining: boolean;
  adult?: number;   // dollars — omit if price not yet known
  child?: number;   // dollars — omit if same as adult or not offered
};

export type VesselSeed = {
  name: string;
  slug: string;
  color: string;      // hex, e.g. "#000099"
  capacity: number;
  products: ProductSeed[];
};

export type OperatorSeed = {
  name: string;
  slug: string;
  emailFrom: string;
  emailDomain: string;
  twilioFromNumber?: string;
  termsUrl?: string;
};

export type DomainSeed = {
  domain: string;
  primary: boolean;
};

// ─── OpenBoat Fishing — your-domain.com / your-domain.com ─────────────────────

export const operatorData: OperatorSeed = {
  name: "OpenBoat Fishing",
  slug: "captree",
  emailFrom: "office@oceansidecharters.example.com",
  emailDomain: "oceansidecharters.example.com",
};

export const domainData: DomainSeed[] = [
  { domain: "your-domain.com",         primary: true  },
  { domain: "your-domain.com", primary: false },
];

// Colors and capacities sourced from the incumbent /boats API endpoint.
// Products sourced from incumbent /info/DSLVFD8QBSNR8/ (publish=true only).
// Prices sourced from incumbent /tickets endpoint (adult/child in dollars).
// Products with no price: incumbent used custom price keys — set via admin dashboard.

export const fleetData: VesselSeed[] = [
  {
    name: "Blue Wave",
    slug: "blue-wave",
    color: "#000099",
    capacity: 29,
    products: [
      { displayName: "4th of July Fireworks Cruise",     category: "Fireworks",       showRemaining: false, adult: 65,  child: 65  },
      { displayName: "Bay Fluke",                        category: "Fluke",            showRemaining: true,  adult: 58,  child: 40  },
      { displayName: "Bay Fluke / Blues / Bass",         category: "Fluke / Striper",  showRemaining: true,  adult: 61,  child: 40  },
      { displayName: "Blackfishing",                     category: "Blackfish",        showRemaining: true,  adult: 65,  child: 65  },
      { displayName: "Fluke",                            category: "Fluke",            showRemaining: true,  adult: 59,  child: 59  },
      { displayName: "Full Day Blackfish",               category: "Blackfish",        showRemaining: true,  adult: 79,  child: 79  },
      { displayName: "Night Striped Bass",               category: "Striped Bass",     showRemaining: true,  adult: 65,  child: 65  },
      { displayName: "Opening Day Fluke Special",        category: "Fluke",            showRemaining: true,  adult: 85,  child: 85  },
      { displayName: "Sea Bass",                         category: "Sea Bass",         showRemaining: true,  adult: 75,  child: 75  },
      { displayName: "Striped Bass",                     category: "Striped Bass",     showRemaining: true                          },
      { displayName: "Striped Bass, Bluefish, Weakfish", category: "Striped Bass",     showRemaining: true,  adult: 65,  child: 65  },
      { displayName: "Stripers and Blues",               category: "Striped Bass",     showRemaining: true                          },
    ],
  },
  {
    name: "Blue Wave Express",
    slug: "blue-wave-express",
    color: "#CC0000",
    capacity: 29,
    products: [
      { displayName: "4th of July Fireworks",            category: "Fireworks",        showRemaining: false, adult: 65,  child: 65  },
      { displayName: "Bay Blues / Bass / Weakfish",      category: "Striped Bass",     showRemaining: true,  adult: 65,  child: 65  },
      { displayName: "Express Stripers",                 category: "Striped Bass",     showRemaining: true,  adult: 65,  child: 65  },
      { displayName: "Fluke",                            category: "Fluke",            showRemaining: true,  adult: 69,  child: 69  },
      { displayName: "Fluke / Jigging Stripers & Blues", category: "Fluke / Striper",  showRemaining: true,  adult: 63,  child: 63  },
      { displayName: "Fluke / Sea Bass",                 category: "Sea Bass / Fluke", showRemaining: true,  adult: 72,  child: 72  },
      { displayName: "Full Day Blackfish",               category: "Blackfish",        showRemaining: true,  adult: 79,  child: 79  },
      { displayName: "Full Day Wreck Fishing",           category: "Sea Bass",         showRemaining: true,  adult: 119, child: 119 },
      { displayName: "Ling Marathon",                    category: "Ling",             showRemaining: true,  adult: 89,  child: 89  },
      { displayName: "Night Bay Bluefish",               category: "Striped Bass",     showRemaining: true,  adult: 62,  child: 62  },
      { displayName: "Night Ling Fishing",               category: "Ling",             showRemaining: true,  adult: 79,  child: 79  },
      { displayName: "Night Striped Bass",               category: "Striped Bass",     showRemaining: true,  adult: 65,  child: 65  },
      { displayName: "Sea Bass",                         category: "Sea Bass",         showRemaining: true,  adult: 79,  child: 79  },
      { displayName: "Sea Bass Opener",                  category: "Sea Bass",         showRemaining: true,  adult: 75,  child: 75  },
      { displayName: "Seal Watching",                    category: "Nature Cruise",    showRemaining: true,  adult: 37,  child: 37  },
      { displayName: "Spring Blackfish",                 category: "Blackfish",        showRemaining: true,  adult: 99,  child: 99  },
      { displayName: "Striper / Pelagic Jigging",        category: "Striper / Pelagics", showRemaining: true, adult: 69, child: 69 },
      { displayName: "Super Deepwater Wreck Trip",       category: "Cod",              showRemaining: true                          },
    ],
  },
  {
    name: "Harbor Princess",
    slug: "harbor-princess",
    color: "#CC00CC",
    capacity: 120,
    products: [
      { displayName: "13 Hour Deepwater Sea Bass",       category: "Sea Bass",          showRemaining: false, adult: 155, child: 155 },
      { displayName: "24 Hour Tilefish Special",         category: "Tilefish",          showRemaining: true,  adult: 399, child: 399 },
      { displayName: "4th of July Fireworks",            category: "Fireworks",         showRemaining: false, adult: 65,  child: 65  },
      { displayName: "Bay Blues",                        category: "Striped Bass",      showRemaining: false                         },
      { displayName: "Bay Fluke",                        category: "Fluke",             showRemaining: false                         },
      { displayName: "Fluke",                            category: "Fluke",             showRemaining: false                         },
      { displayName: "Fluke / Sea Bass",                 category: "Sea Bass / Fluke",  showRemaining: false, adult: 68,  child: 40  },
      { displayName: "Fluke / Sea Bass / Porgies",       category: "Sea Bass / Fluke",  showRemaining: false, adult: 59,  child: 40  },
      { displayName: "Ling Marathon",                    category: "Ling",              showRemaining: false, adult: 85,  child: 85  },
      { displayName: "Night Bass / Blues / Weakfish",    category: "Striped Bass",      showRemaining: false, adult: 65,  child: 40  },
      { displayName: "Night Sea Bass / Porgies / Blues", category: "Sea Bass / Porgies", showRemaining: false                       },
      { displayName: "Night Squid",                      category: "Blackfish",         showRemaining: false, adult: 75,  child: 75  },
      { displayName: "Ocean Blackfish",                  category: "Blackfish",         showRemaining: false, adult: 79,  child: 79  },
      { displayName: "Ocean Wrecks",                     category: "Ling",              showRemaining: false                         },
      { displayName: "Pelagic Jigging Special",          category: "Pelagics",          showRemaining: true,  adult: 65,  child: 65  },
      { displayName: "Princess Blackfish",               category: "Blackfish",         showRemaining: false                         },
      { displayName: "Princess Sea Bass Opener",         category: "Sea Bass",          showRemaining: false, adult: 75,  child: 75  },
      { displayName: "Princess Striper Jigging",         category: "Striped Bass",      showRemaining: false                         },
    ],
  },
  {
    name: "Harbor Star",
    slug: "harbor-star",
    color: "#FFC107",
    capacity: 115,
    products: [
      { displayName: "34 Hour Canyon Tuna",                     category: "Bluefish",         showRemaining: true,  adult: 475, child: 475 },
      { displayName: "4th of July Fireworks",                   category: "Fireworks",        showRemaining: false, adult: 65,  child: 65  },
      { displayName: "Bay Fluke",                               category: "Fluke",            showRemaining: false, adult: 59,  child: 35  },
      { displayName: "Fluke / Jigging Bass / Blues / Weakfish", category: "Fluke / Striper",  showRemaining: false                         },
      { displayName: "Fluke",                                   category: "Fluke",            showRemaining: false, adult: 67,  child: 47  },
      { displayName: "Full Day Ocean",                          category: "Fluke / Pelagics", showRemaining: false, adult: 95,  child: 95  },
      { displayName: "Ling / Sea Bass / Porgy Marathon",        category: "Ling",             showRemaining: true,  adult: 79,  child: 79  },
      { displayName: "Full Day Ocean Fluke",                    category: "Sea Bass / Fluke", showRemaining: false, adult: 105, child: 105 },
      { displayName: "Full Day Wrecks",                         category: "Sea Bass / Ling",  showRemaining: false, adult: 85,  child: 85  },
      { displayName: "Sea Bass / Fluke",                        category: "Sea Bass / Fluke", showRemaining: false, adult: 62,  child: 40  },
      { displayName: "Pride Striper Jigging",                   category: "Striped Bass",     showRemaining: false                         },
      { displayName: "Trophy Striper Hunt",                     category: "Striped Bass",     showRemaining: false, adult: 67,  child: 67  },
      { displayName: "Two Day Tilefish & Tuna",                 category: "Tilefish",         showRemaining: true,  adult: 700, child: 700 },
    ],
  },
];
