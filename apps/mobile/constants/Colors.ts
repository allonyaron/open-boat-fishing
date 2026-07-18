/**
 * Design system colors — matches the web app palette.
 * Teal is the primary brand color; adjust per operator deployment.
 */
export const Colors = {
  // Brand
  teal: '#0E7C7B',
  tealLight: '#1A9E9C',
  tealDark: '#0A5E5D',

  // Text
  ink: '#10201F',
  inkMuted: '#3D5A59',
  inkSubtle: '#6B8A89',

  // Backgrounds
  surface: '#FFFFFF',
  surfaceAlt: '#F4F8F8',
  border: '#D1E0DF',

  // Semantic
  success: '#22C55E',
  warning: '#F59E0B',
  error: '#EF4444',
  info: '#3B82F6',

  // Tab bar
  tabIconDefault: '#6B8A89',
  tabIconSelected: '#0E7C7B',
  tabBackground: '#FFFFFF',

  // Example vessel accent colors — actual colors are stored on the vessels row in DB
  boatBlue: '#1D4ED8',
  boatRed: '#DC2626',
  boatAmber: '#D97706',
  boatGreen: '#16A34A',
} as const;

export type ColorKey = keyof typeof Colors;
