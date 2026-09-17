/**
 * Captree Fishing — native app design tokens.
 * Ported from design_handoff_native_app/tokens.ts (Claude Design handoff).
 * Scoped to the redesigned consumer screens — does not touch constants/Colors.ts,
 * which the mate app also imports.
 */

export const color = {
  hull: "#16354a",
  hull2: "#1c4260",
  hullLine: "#3c5867",

  orange: "#c94510",
  orangeInk: "#b1440f",
  orangePress: "#8c3b12",
  orangeLight: "#ff8a5c",
  orangeOnOrange: "#ffe3d6",

  deck: "#eef1f0",
  deck2: "#e6eaea",
  deck3: "#f6f8f8",

  rule: "#cdd6da",
  ruleSoft: "#e3e9eb",
  emptyFill: "#f1f4f5",

  ink2: "#41565f",
  ink3: "#5b6f79",
  mutedMark: "#7d93a1",

  disabledFill: "#b9c3c7",
  disabledBorder: "#9aa8ae",

  inkOnDark: "#dfe8ec",
  inkOnDark2: "#b6c6ce",
  inkOnDark3: "#c9d6dd",

  greenOpen: "#186a4a",
  pastFill: "#e6ebeb",
  pastInk: "#8a999f",

  lockGround: "#0d1c26",

  white: "#ffffff",
} as const;

/** Trip-type / vessel color bars. */
export const tripType = {
  bay: { label: "BAY", color: "#186a4a" },
  offshore: { label: "OFFSHORE", color: "#245e78" },
  overnight: { label: "OVERNIGHT", color: "#8c3b12" },
} as const;

/** Seat pill — mirrors SeatPill in apps/web SailingsSection.tsx. Few-left threshold is 6. */
export function seatPill(seatsRemaining: number): { label: string; color: string } {
  if (seatsRemaining === 0) return { label: "SOLD OUT", color: color.ink3 };
  if (seatsRemaining <= 6) return { label: `${seatsRemaining} LEFT`, color: color.orangePress };
  return { label: `${seatsRemaining} OPEN`, color: color.greenOpen };
}

/** Font family names as registered by useFonts() in app/_layout.tsx. */
export const font = {
  sans: "Archivo_400Regular",
  sansMedium: "Archivo_500Medium",
  sansSemibold: "Archivo_600SemiBold",
  sansBold: "Archivo_700Bold",
  sansExtrabold: "Archivo_800ExtraBold",
  mono: "IBMPlexMono_400Regular",
  monoMedium: "IBMPlexMono_500Medium",
  monoSemibold: "IBMPlexMono_600SemiBold",
  monoBold: "IBMPlexMono_700Bold",
} as const;

/** Caps tracking, in em — multiply by fontSize for React Native's absolute letterSpacing. */
export const tracking = {
  data: 0.06,
  label: 0.1,
  caps: 0.12,
  head: 0.14,
  kicker: 0.16,
  kickerWide: 0.18,
} as const;

export function ls(fontSize: number, em: number): number {
  return Math.round(fontSize * em * 100) / 100;
}

/** borderRadius is 0 everywhere in app content. Rounded corners only on system-drawn surfaces. */
export const radius = 0;

export const space = {
  gutter: 16,
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 26,
} as const;

export const size = {
  appBar: 44,
  navBar: 48,
  /** 3px orange rule under every navy app bar. */
  appBarRule: 3,
  tabBar: 49,
  tabActiveRule: 3,
  dayChip: 56,
  dayChipCountRow: 11,
  calendarCell: 44,
  stepperButton: 52,
  stepperHeight: 48,
  tapMin: 44,
  primaryButton: 58,
  payButton: 66,
  /** Locked glyph size — do not scale. */
  glyph: { width: 17, height: 9, viewBox: "0.4 1.4 25.2 12.2" },
} as const;

/** Hairlines are 1px inset rings on web; RN has no inset box-shadow, so use a 1px border. */
export const hairline = { color: color.rule, width: 1 } as const;

/** Seat-hold timing. Expiry is server-owned; these are display thresholds. */
export const hold = { durationSecs: 600, warningSecs: 120 } as const;
