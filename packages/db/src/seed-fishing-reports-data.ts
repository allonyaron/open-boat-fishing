// ─── Fishing report seed content ─────────────────────────────────────────────
// Species profiles and phrase pools for seed-fishing-reports.ts.
//
// Two voices:
//   logbook — the deadpan party-boat daily log: "Today's 7:01AM trip caught
//             462 Fluke; keeping 54 to 7.4LBS, 33 Sea Bass, 3 Porgies and
//             1 Cape Shark." Every fish over the rail gets listed, oddballs too.
//   hype    — breathless all-caps marketing copy with crew shoutouts and pools.
//
// Counts and bycatch are modelled on real Long Island party-boat logs. Every
// name here is made up. Never paste a real operator's reports in.

export type Rng = () => number;

export const pick = <T>(rng: Rng, items: readonly T[]): T =>
  items[Math.floor(rng() * items.length)];

export const between = (rng: Rng, min: number, max: number) =>
  Math.round(min + rng() * (max - min));

export interface FishName {
  one: string;
  many: string;
}

/** [fish, min, max, chance of showing up at all] */
export type Bycatch = [FishName, number, number, number];

export interface SpeciesProfile {
  name: FishName;
  /** Boat-wide count range on a normal day. */
  caught: [number, number];
  /** Share kept, for fish with a tight size limit ("caught 462; keeping 54"). */
  keepRate?: [number, number];
  /** Count above which the log says "Keeping a Full Boat Limit". */
  fullLimitAt?: number;
  /** Biggest-fish weight range in lbs, for "to 7.4LBS" and the pool. */
  maxLbs?: [number, number];
  bycatch: Bycatch[];
  /** Hype voice: nickname for a big one, e.g. "doormat". */
  bigOne: string;
  /** Hype voice lines. {n} = count, {big} = bigOne. */
  lines: string[];
}

const fish = (one: string, many = one): FishName => ({ one, many });

export const FISH = {
  fluke: fish("Fluke"),
  seaBass: fish("Sea Bass"),
  porgy: fish("Porgy", "Porgies"),
  blackfish: fish("Blackfish"),
  stripedBass: fish("Striped Bass"),
  bluefish: fish("Bluefish"),
  weakfish: fish("Weakfish"),
  ling: fish("Ling"),
  cod: fish("Cod"),
  tilefish: fish("Tilefish"),
  tuna: fish("Yellowfin Tuna"),
  mahi: fish("Mahi"),
  squid: fish("Squid"),
  seaRobin: fish("Sea Robin", "Sea Robins"),
  capeShark: fish("Cape Shark"),
  blowfish: fish("Blowfish"),
  stargazer: fish("Stargazer", "Stargazers"),
  triggerfish: fish("Trigger Fish"),
  cunner: fish("Cunner"),
  mackerel: fish("Mackerel"),
  bonita: fish("Bonita"),
  eel: fish("Eel", "Eels"),
  redHake: fish("Big Red Hake"),
  pollack: fish("Pollack"),
  whiteHake: fish("White Hake"),
  blueline: fish("Blueline Tilefish"),
  skipjack: fish("Skipjack"),
};

// One of these turns up now and then on any trip. The funnier the better.
export const ODDBALLS: FishName[] = [
  fish("Lobster"),
  fish("Toad Fish"),
  fish("Barrel Fish"),
  fish("Cobia"),
  fish("Atlantic Gar"),
  fish("Sundial"),
  fish("Albacore"),
  fish("Flounder"),
  fish("Sheepshead"),
  fish("Horseshoe Crab"),
];
export const ODDBALL_RATE = 0.06;

export const SPECIES: Record<string, SpeciesProfile> = {
  fluke: {
    name: FISH.fluke,
    caught: [20, 700],
    keepRate: [0.07, 0.2],
    maxLbs: [4, 8.4],
    bycatch: [
      [FISH.seaRobin, 2, 35, 0.9],
      [FISH.seaBass, 2, 45, 0.7],
      [FISH.capeShark, 1, 17, 0.4],
      [FISH.blowfish, 1, 3, 0.25],
      [FISH.stargazer, 1, 2, 0.12],
      [FISH.porgy, 1, 3, 0.2],
      [FISH.bluefish, 1, 2, 0.15],
    ],
    bigOne: "doormat",
    lines: [
      "The fluke were STACKED on the drift, {n} over the rail!!",
      "Bucktail and Gulp was the ticket today, {n} fluke and a TON of shorts released to fight another day!",
      "Drift after drift the rods were bending, {n} fluke boat-wide and a few legit {big}s!!",
    ],
  },
  seaBass: {
    name: FISH.seaBass,
    caught: [200, 1100],
    fullLimitAt: 340,
    maxLbs: [3, 6],
    bycatch: [
      [FISH.porgy, 10, 700, 0.85],
      [FISH.ling, 3, 80, 0.5],
      [FISH.mackerel, 1, 90, 0.35],
      [FISH.triggerfish, 1, 28, 0.35],
      [FISH.bluefish, 1, 130, 0.35],
      [FISH.bonita, 1, 40, 0.2],
      [FISH.cunner, 2, 60, 0.25],
      [FISH.eel, 1, 10, 0.2],
      [FISH.blackfish, 1, 7, 0.2],
      [FISH.fluke, 1, 50, 0.4],
    ],
    bigOne: "knothead",
    lines: [
      "The sea bass were CHEWING, {n} and plenty of big blue-headed {big}s in the mix!!",
      "We anchored up on the wreck and it was double-headers all around, {n} sea bass!",
    ],
  },
  porgy: {
    name: FISH.porgy,
    caught: [50, 850],
    maxLbs: [2, 3.5],
    bycatch: [
      [FISH.seaBass, 20, 300, 0.9],
      [FISH.triggerfish, 1, 10, 0.3],
      [FISH.bluefish, 1, 20, 0.3],
    ],
    bigOne: "hubcap",
    lines: ["Porgies were on EVERY drop, {n} of them, a bunch of real {big}s!!"],
  },
  blackfish: {
    name: FISH.blackfish,
    caught: [8, 310],
    maxLbs: [5, 9.4],
    bycatch: [
      [FISH.cunner, 1, 32, 0.7],
      [FISH.seaBass, 1, 3, 0.3],
      [FISH.porgy, 1, 5, 0.25],
      [FISH.capeShark, 2, 15, 0.2],
      [FISH.seaRobin, 1, 7, 0.15],
      [FISH.mackerel, 1, 2, 0.1],
    ],
    bigOne: "bulldog",
    lines: [
      "The tog bite was ON FIRE today!! {n} blackfish and some MONSTER {big}s on green crabs!",
      "Blackfish were tight to the rocks and our anglers were tighter, {n} boat-wide!!",
    ],
  },
  stripedBass: {
    name: FISH.stripedBass,
    caught: [1, 300],
    fullLimitAt: 70,
    maxLbs: [18, 42],
    bycatch: [
      [FISH.capeShark, 1, 12, 0.3],
      [FISH.bluefish, 1, 57, 0.4],
      [FISH.weakfish, 1, 3, 0.15],
    ],
    bigOne: "cow",
    lines: [
      "BASS ARE HERE!! {n} stripers came over the rail including a couple of real {big}s!!",
      "We found the bass on the bunker schools and it went OFF, {n} stripers!",
    ],
  },
  bluefish: {
    name: FISH.bluefish,
    caught: [1, 60],
    maxLbs: [6, 15],
    bycatch: [
      [FISH.weakfish, 1, 3, 0.25],
      [FISH.fluke, 1, 16, 0.35],
      [FISH.stripedBass, 1, 2, 0.25],
      [FISH.seaRobin, 1, 13, 0.2],
    ],
    bigOne: "gator",
    lines: [
      "CHOPPERS EVERYWHERE!! {n} bluefish and some absolute {big}s that bit through EVERYTHING!",
      "The blues were blitzing on top, {n} bluefish!!",
    ],
  },
  weakfish: {
    name: FISH.weakfish,
    caught: [1, 12],
    maxLbs: [3, 8],
    bycatch: [[FISH.bluefish, 1, 10, 0.6]],
    bigOne: "tiderunner",
    lines: ["Weakfish showed up!! {n} of them including a beautiful {big}!"],
  },
  ling: {
    name: FISH.ling,
    caught: [40, 340],
    maxLbs: [1.5, 3],
    bycatch: [
      [FISH.seaBass, 20, 220, 0.8],
      [FISH.redHake, 5, 125, 0.3],
      [FISH.porgy, 2, 20, 0.3],
      [FISH.capeShark, 2, 24, 0.4],
    ],
    bigOne: "slimer",
    lines: ["Ling, ling and MORE LING, {n} boat-wide and some nice {big}s mixed in!"],
  },
  cod: {
    name: FISH.cod,
    caught: [3, 40],
    maxLbs: [12, 32],
    bycatch: [
      [FISH.pollack, 1, 20, 0.6],
      [FISH.whiteHake, 1, 10, 0.4],
      [FISH.redHake, 5, 40, 0.5],
      [FISH.seaBass, 50, 400, 0.7],
    ],
    bigOne: "bull cod",
    lines: ["COD ARE CHEWING out deep!! {n} cod over the rail including a gorgeous {big}!"],
  },
  tilefish: {
    name: FISH.tilefish,
    caught: [10, 60],
    maxLbs: [15, 40],
    bycatch: [[FISH.blueline, 5, 80, 0.8]],
    bigOne: "golden",
    lines: ["Deep drop success!! {n} tilefish came up from the canyon and they were BEAUTIFUL {big}s!"],
  },
  tuna: {
    name: FISH.tuna,
    caught: [1, 14],
    maxLbs: [40, 90],
    bycatch: [
      [FISH.mahi, 1, 12, 0.5],
      [FISH.skipjack, 1, 8, 0.3],
    ],
    bigOne: "football",
    lines: ["TUNA TIME!!! {n} yellowfin landed and the fight on some of these was over 30 minutes!!"],
  },
  mahi: {
    name: FISH.mahi,
    caught: [1, 30],
    maxLbs: [8, 20],
    bycatch: [[FISH.bonita, 1, 10, 0.4]],
    bigOne: "bull",
    lines: ["We found a lobster pot buoy LOADED with mahi, {n} of them and one big {big}!!"],
  },
  squid: {
    name: FISH.squid,
    caught: [120, 600],
    bycatch: [
      [FISH.bluefish, 1, 10, 0.4],
      [FISH.seaRobin, 1, 5, 0.2],
    ],
    bigOne: "monster squid",
    lines: ["The squid were swarming the lights!! {n} squid and EVERYBODY got inked at least once, LOL!"],
  },
};

// Matched against `${product.displayName} ${product.category}`, lowercased.
// The first match is the trip's target species; later matches add to the box.
export const SPECIES_RULES: [RegExp, keyof typeof SPECIES][] = [
  [/tuna/, "tuna"],
  [/tilefish/, "tilefish"],
  [/\bcod\b|super deep/, "cod"],
  [/squid/, "squid"],
  [/blackfish|\btog/, "blackfish"],
  [/fluke/, "fluke"],
  [/sea bass|wreck/, "seaBass"],
  [/porg/, "porgy"],
  [/strip|(?<!sea )\bbass\b/, "stripedBass"],
  [/blue/, "bluefish"],
  [/weakfish/, "weakfish"],
  [/\bling\b/, "ling"],
  [/pelagic/, "mahi"],
];

// Products with no fish to report.
export const NON_FISHING = /fireworks|seal watch|nature cruise/i;

// When nothing matches, assume a generic wreck/bottom trip.
export const FALLBACK_SPECIES: (keyof typeof SPECIES)[] = ["seaBass"];

// ── Logbook voice ────────────────────────────────────────────────────────────

/** "NEW FREE FOR LIFE LEADER {name}." — the season-long biggest-fish contest. */
export const FREE_FOR_LIFE_RATE = 0.04;
export const FREE_FOR_LIFE_LEADERS = [
  "WALTER K.",
  "Stephanie R.",
  "Big Sal",
  "DONNA M.",
  "Hector P.",
  "Little Joey",
  "MARGARET T.",
  "Rocco",
];

/** Night trips that come home empty: "Tonight's 6PM trip caught nothing." */
export const SKUNK_RATE = 0.06;

// ── Hype voice ───────────────────────────────────────────────────────────────

export const CAPTAINS = ["Capt. Sal", "Capt. Joey", "Capt. Ritchie", "Capt. Denise", "Capt. Vinnie"];
export const MATES = ["Mate Kevin", "Mate Dee", "Mate Paulie", "Mate Tommy", "Mate Gina", "Mate Frankie"];

export const POOL_WINNERS = [
  "Big Mike from Massapequa",
  "Tommy D. from Bay Shore",
  "little Ava (age 9!!)",
  "Ray from Lindenhurst",
  "Maria from Queens",
  "Joe \"the Plumber\" from Islip",
  "Stevie from Brooklyn",
  "first-timer Priya",
  "regular Eddie (as usual, lol)",
  "Grandpa Lou, 81 years young",
  "Danny from Jersey",
  "Kim from Babylon",
  "Carlos from West Islip",
  "Nicky from Seaford",
];

export const OPENERS = [
  "WOW WHAT A DAY!!!",
  "UNBELIEVABLE FISHING TODAY!!!",
  "Another BANNER day on the water!!",
  "HOLY MACKEREL what a trip!!",
  "You had to be here folks!!!",
  "The fishing gods were SMILING on us today!!",
  "Just when you thought it couldn't get better... IT DID!!!",
];

export const NIGHT_OPENERS = [
  "WHAT A NIGHT!!!",
  "The night bite did NOT disappoint!!",
  "Under the lights and they were BITING!!",
];

export const SLOW_OPENERS = [
  "They made us WORK for it today, but that's fishing!!",
  "Tough tide and a stiff breeze, but our crew never gives up!!",
  "Not our best day, but still a beautiful day on the water!!",
];

export const CREW_LINES = [
  "{captain} put us RIGHT on them all day long!",
  "Huge shoutout to {mate} who was untangling, netting and baiting nonstop!!",
  "{captain} and {mate} worked SO hard to keep everybody on fish!",
  "{captain} moved us three times until we found the fish and boy did we FIND THEM!",
  "{mate} was gaffing fish left and right, give that mate a RAISE!",
];

export const POOL_LINES = [
  "Pool went to {winner} with a {lbs} lb {species}!!",
  "Congrats to {winner} who took the pool with a {lbs} lb {big}!!",
  "{winner} won the pool with a {lbs} pounder!! WHAT A FISH!",
];

export const CLOSERS = [
  "Come join us, we sail again tomorrow!!",
  "Don't miss out, the fish are HERE!! Book now!",
  "See you on the water!! 🎣",
  "Spots are filling up fast, reserve online!!",
  "Tight lines everybody!!",
];
