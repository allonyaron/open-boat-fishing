// ─── Brand primitives ──────────────────────────────────────────────────────────

export const navy = {
  DEFAULT: "#14233d",
  medium: "#0e1930",
  light: "#1F3F5C",
  tint: "#EBF0F5",
} as const;

export const gold = {
  DEFAULT: "#c99a3f",
  hover: "#b5872f",
  light: "#e7d9b8",
  tint: "#fdf8ec",
} as const;

export const teal = {
  DEFAULT: "#0E7C7B",
  light: "#1A9E9C",
  dark: "#0A5E5D",
  hover: "#0B6B6A",
  tint: "#E3F0EF",
} as const;

// amber = warm caution/attention tone (used for in-progress states, scan warnings)
export const amber = {
  DEFAULT: "#c9862f",
  dark: "#a86e22",
  bg: "#fdf1e3",
} as const;

// ─── Text ──────────────────────────────────────────────────────────────────────

export const ink = "#1c2333";
export const muted = "#4A5E6A";
export const faint = "#9a9fac";

// ─── Surfaces ──────────────────────────────────────────────────────────────────

export const surface = "#f5f3ef";   // warm off-white page/screen background
export const fill = "#F1F4F3";       // secondary background (inputs, alternating rows)
export const hairline = "#ECEFEE";   // lightest divider
export const cardBorder = "#DFE4E3"; // card/panel border

// ─── Semantic ──────────────────────────────────────────────────────────────────

export const success = {
  DEFAULT: "#3f8f5e",
  dark: "#2d6b47",
  bg: "#e8f2ed",
} as const;

export const warning = {
  DEFAULT: "#c65b4e",
  dark: "#a84940",
  bg: "#FBEBEA",
} as const;

export const error = {
  DEFAULT: "#EF4444",
  bg: "#FEE2E2",
} as const;

export const info = {
  DEFAULT: "#3B82F6",
} as const;

export const disabled = {
  DEFAULT: "#DCE2E1",
  text: "#9AA7A6",
} as const;

// ─── Spacing (4-point scale, numeric px) ─────────────────────────────────────

export const spacing = {
  xxs: 2,
  xs: 4,
  sm: 6,
  md: 8,
  lg: 12,
  xl: 16,
  xxl: 24,
  xxxl: 32,
  xxxxl: 40,
} as const;

// ─── Border radius ─────────────────────────────────────────────────────────────

export const radius = {
  xs: 2,
  sm: 8,
  md: 12,
  lg: 14,
  xl: 20,
  pill: 999,
} as const;

// ─── Type scale (px) ──────────────────────────────────────────────────────────

export const fontSize = {
  xs: 11,
  sm: 12,
  base: 13,
  md: 14,
  lg: 15,
  xl: 16,
  xxl: 18,
  h3: 20,
  h2: 28,
  h1: 32,
  display: 36,
} as const;

export const lineHeight = {
  tight: 18,
  base: 20,
  relaxed: 24,
  loose: 44,
} as const;
