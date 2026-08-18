export const Colors = {
  // Brand
  teal: "#0E7C7B",
  tealLight: "#1A9E9C",
  tealDark: "#0A5E5D",

  // Text
  ink: "#10201F",
  inkMuted: "#3D5A59",
  inkSubtle: "#6B8A89",

  // Backgrounds
  surface: "#FFFFFF",
  surfaceAlt: "#F4F8F8",
  border: "#D1E0DF",
  successTint: "#F0FDF4",

  // Semantic
  success: "#22C55E",
  warning: "#F59E0B",
  error: "#EF4444",
  info: "#3B82F6",

  // Utility
  shadow: "#000000",
  scrim: "#000000",
  white: "#FFFFFF",
  backdrop: "rgba(0,0,0,0.45)",
  whiteA75: "rgba(255,255,255,0.75)",
  whiteA85: "rgba(255,255,255,0.85)",
  whiteA90: "rgba(255,255,255,0.90)",

  // Semantic state colors (darker variants for solid backgrounds)
  successDark: "#16A34A",
  warningDark: "#D97706",

  // Tab bar
  tabIconDefault: "#6B8A89",
  tabIconSelected: "#0E7C7B",
  tabBackground: "#FFFFFF",

  // Vessel accent colors — actual values come from the vessels DB row
  boatBlue: "#1D4ED8",
  boatRed: "#DC2626",
  boatAmber: "#D97706",
  boatGreen: "#16A34A",
} as const;

export type ColorKey = keyof typeof Colors;
