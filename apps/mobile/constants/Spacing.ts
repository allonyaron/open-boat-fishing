import { spacing, radius } from "@openboat/design";

export const Spacing = {
  xxs: spacing.xxs,
  xs: spacing.xs,
  sm: spacing.sm,
  md: spacing.md,
  lg: spacing.lg,
  xl: spacing.xl,
  xxl: spacing.xxl,
  xxxl: spacing.xxxl,
  xxxxl: spacing.xxxxl,
} as const;

// Component-level padding values (not in the base scale)
export const Padding = {
  btnVertical: 14,
  inputHorizontal: 16,
  cardHorizontal: 28,
} as const;

export const Radius = {
  xs: radius.xs,
  sm: radius.sm,
  md: radius.md,
  lg: radius.lg,
  pill: radius.pill,
} as const;

// React Native shadow props (web equivalent is box-shadow)
export const Shadow = {
  card: {
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 2,
  },
  modal: {
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 8,
  },
} as const;
