// ─── Fishing report seed content ─────────────────────────────────────────────
// Phrase pools for seed-fishing-reports.ts. Written in the breathless, all-caps,
// exclamation-heavy voice of a real party-boat report. Every name here is made
// up: crew, pool winners, and boats. Never paste a real operator's reports in.

export type Rng = () => number;

export const pick = <T>(rng: Rng, items: readonly T[]): T =>
  items[Math.floor(rng() * items.length)];

export const between = (rng: Rng, min: number, max: number) =>
  Math.round(min + rng() * (max - min));

export interface SpeciesProfile {
  species: string;
  /** Boat-wide count range on a normal day. */
  count: [number, number];
  /** Pool fish weight range in lbs. Absent = no pool on this species. */
  poolLbs?: [number, number];
  /** Nickname for a big one, e.g. "doormat". */
  bigOne: string;
  /** Species-specific lines. {n} = count, {big} = bigOne. */
  lines: string[];
}

export const SPECIES: Record<string, SpeciesProfile> = {
  fluke: {
    species: "Fluke",
    count: [18, 90],
    poolLbs: [4, 10],
    bigOne: "doormat",
    lines: [
      "The fluke were STACKED on the drift and we put {n} keepers in the box!!",
      "Bucktail and Gulp was the ticket today, {n} keepers and a TON of shorts released to fight another day!",
      "Drift after drift the rods were bending, {n} keepers boat-wide and a few legit {big}s!!",
      "Started slow on the first drift then the tide turned and it was GAME ON, {n} fluke in the box!",
    ],
  },
  seaBass: {
    species: "Sea Bass",
    count: [80, 380],
    poolLbs: [3, 6],
    bigOne: "knothead",
    lines: [
      "The sea bass were CHEWING, {n} keepers and plenty of big blue-headed {big}s in the mix!!",
      "We anchored up on the wreck and it was double-headers all around, {n} sea bass in the box!",
      "Limits for a bunch of people today!! {n} sea bass boat-wide and the jigs were working too!",
    ],
  },
  porgy: {
    species: "Porgy",
    count: [60, 300],
    poolLbs: [2, 3],
    bigOne: "hubcap",
    lines: [
      "Porgies were on EVERY drop, {n} of them, a bunch of real {big}s!!",
      "Clam on the bottom and it was nonstop porgy action, {n} in the box, the kids LOVED it!",
    ],
  },
  blackfish: {
    species: "Blackfish",
    count: [20, 110],
    poolLbs: [6, 13],
    bigOne: "bulldog",
    lines: [
      "The tog bite was ON FIRE today!! {n} keepers and some MONSTER {big}s on green crabs!",
      "Blackfish were tight to the rocks and our anglers were tighter, {n} keepers boat-wide!!",
      "You gotta be quick on the hookset with these guys and today everybody was, {n} blackfish in the box!",
    ],
  },
  stripedBass: {
    species: "Striped Bass",
    count: [6, 40],
    poolLbs: [16, 38],
    bigOne: "cow",
    lines: [
      "BASS ARE HERE!! {n} stripers came over the rail tonight including a couple of real {big}s!!",
      "We found the bass on the bunker schools and it went OFF, {n} stripers, released plenty of overs too!",
      "Live eels did the job tonight, {n} striped bass and the drag was SCREAMING all night!",
    ],
  },
  bluefish: {
    species: "Bluefish",
    count: [25, 160],
    poolLbs: [7, 16],
    bigOne: "gator",
    lines: [
      "CHOPPERS EVERYWHERE!! {n} bluefish and some absolute {big}s that bit through EVERYTHING!",
      "The blues were blitzing on top and our anglers got into them hard, {n} bluefish in the box!!",
      "Diamond jigs and chunks were both working, {n} blues and a couple of {big}s that pulled like trains!",
    ],
  },
  weakfish: {
    species: "Weakfish",
    count: [5, 30],
    poolLbs: [3, 8],
    bigOne: "tiderunner",
    lines: [
      "Bonus weakfish showed up too!! {n} of them including a beautiful {big}!",
    ],
  },
  ling: {
    species: "Ling",
    count: [40, 220],
    poolLbs: [1, 3],
    bigOne: "slimer",
    lines: [
      "The ling were thick on the bottom, {n} of them, everybody went home with a bag full of fillets!!",
      "Ling, ling and MORE LING, {n} boat-wide and some nice {big}s mixed in!",
    ],
  },
  cod: {
    species: "Cod",
    count: [6, 40],
    poolLbs: [12, 32],
    bigOne: "bull cod",
    lines: [
      "COD ARE CHEWING out deep!! {n} cod over the rail including a gorgeous {big}!",
      "The long ride was SO worth it, {n} cod and the jiggers were crushing them!",
    ],
  },
  tilefish: {
    species: "Tilefish",
    count: [10, 60],
    poolLbs: [15, 40],
    bigOne: "golden",
    lines: [
      "Deep drop success!! {n} tilefish came up from the canyon floor and they were BEAUTIFUL {big}s!",
      "The electric reels were humming all morning, {n} tiles boat-wide!!",
    ],
  },
  tuna: {
    species: "Yellowfin Tuna",
    count: [2, 14],
    poolLbs: [40, 90],
    bigOne: "football",
    lines: [
      "TUNA TIME!!! {n} yellowfin landed and the fight on some of these was over 30 minutes!!",
      "We marked them deep and dropped jigs and BOOM, {n} yellowfin on the deck!",
    ],
  },
  mahi: {
    species: "Mahi-Mahi",
    count: [6, 30],
    poolLbs: [8, 20],
    bigOne: "bull",
    lines: [
      "We found a lobster pot buoy LOADED with mahi, {n} of them and one big {big}!!",
    ],
  },
  squid: {
    species: "Squid",
    count: [120, 600],
    bigOne: "monster squid",
    lines: [
      "The squid were swarming the lights!! {n} squid and EVERYBODY got inked at least once, LOL!",
      "Nonstop squid jigging all night, {n} of them, calamari for the whole neighborhood!!",
    ],
  },
  seaRobin: {
    species: "Sea Robin",
    count: [3, 25],
    bigOne: "sea robin",
    lines: ["Plus the usual sea robins croaking at us, {n} of them, lol!"],
  },
};

// Matched against `${product.displayName} ${product.category}`, lowercased.
// Order matters only for readability; every match is kept.
export const SPECIES_RULES: [RegExp, keyof typeof SPECIES][] = [
  [/fluke/, "fluke"],
  [/sea bass/, "seaBass"],
  [/porg/, "porgy"],
  [/blackfish|\btog/, "blackfish"],
  [/strip|(?<!sea )\bbass\b/, "stripedBass"],
  [/blue/, "bluefish"],
  [/weakfish/, "weakfish"],
  [/\bling\b/, "ling"],
  [/\bcod\b/, "cod"],
  [/tilefish/, "tilefish"],
  [/tuna/, "tuna"],
  [/pelagic/, "mahi"],
  [/squid/, "squid"],
];

// Products with no fish to report.
export const NON_FISHING = /fireworks|seal watch|nature cruise/i;

// When nothing matches, assume a generic wreck/bottom trip.
export const FALLBACK_SPECIES: (keyof typeof SPECIES)[] = ["seaBass", "ling"];

export const CAPTAINS = ["Capt. Sal", "Capt. Joey", "Capt. Ritchie", "Capt. Denise", "Capt. Vinnie"];
export const MATES = [
  "Mate Kevin",
  "Mate Dee",
  "Mate Paulie",
  "Mate Tommy",
  "Mate Gina",
  "Mate Frankie",
];

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
  "INSANE. That's the only word for today!!",
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
  "Pool winner was {winner}, {lbs} lbs of pure {species}!!",
];

export const CLOSERS = [
  "Come join us, we sail again tomorrow!!",
  "Don't miss out, the fish are HERE!! Book now!",
  "See you on the water!! 🎣",
  "Spots are filling up fast, reserve online!!",
  "Bring the family, there's room on the rail!!",
  "Tight lines everybody!!",
];
