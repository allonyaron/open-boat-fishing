import {
  amber,
  cardBorder,
  error,
  faint,
  fill,
  info,
  ink,
  muted,
  navy,
  gold,
  success,
  surface,
  teal,
} from "@openboat/design";

export const Colors = {
  // Brand
  teal: teal.DEFAULT,
  tealLight: teal.light,
  tealDark: teal.dark,
  navy: navy.DEFAULT,
  navyLight: navy.light,
  navyTint: navy.tint,
  gold: gold.DEFAULT,
  goldTint: gold.tint,

  // Text
  ink,
  inkMuted: muted,
  inkSubtle: faint,

  // Backgrounds
  surface,
  surfaceAlt: fill,
  border: cardBorder,
  successTint: success.bg,

  // Semantic
  success: success.DEFAULT,
  successDark: success.dark,
  warning: amber.DEFAULT,     // amber = caution/in-progress (pending badge, scan warning)
  warningDark: amber.dark,
  error: error.DEFAULT,
  info: info.DEFAULT,

  // Utility (native-only)
  shadow: "#000000",
  scrim: "#000000",
  white: "#FFFFFF",
  backdrop: "rgba(0,0,0,0.45)",
  whiteA75: "rgba(255,255,255,0.75)",
  whiteA85: "rgba(255,255,255,0.85)",
  whiteA90: "rgba(255,255,255,0.90)",

  // Tab bar
  tabIconDefault: faint,
  tabIconSelected: teal.DEFAULT,
  tabBackground: "#FFFFFF",

  // Vessel accent colors (actual values come from the vessels DB row)
  boatBlue: "#1D4ED8",
  boatRed: "#DC2626",
  boatAmber: "#D97706",
  boatGreen: "#16A34A",
} as const;

export type ColorKey = keyof typeof Colors;
