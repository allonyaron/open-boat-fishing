import { fontSize, lineHeight } from "@openboat/design";

export const FontSize = {
  xs: fontSize.xs,
  sm: fontSize.sm,
  base: fontSize.base,
  md: fontSize.md,
  lg: fontSize.lg,
  xl: fontSize.xl,
  xxl: fontSize.xxl,
  h3: fontSize.h3,
  h2: fontSize.h2,
  h1: fontSize.h1,
  display: fontSize.display,
} as const;

export const LineHeight = {
  tight: lineHeight.tight,
  base: lineHeight.base,
  relaxed: lineHeight.relaxed,
  loose: lineHeight.loose,
} as const;
