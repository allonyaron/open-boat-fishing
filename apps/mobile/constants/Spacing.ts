// 4-point spacing scale
export const Spacing = {
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

// Named padding values that fall between grid steps
export const Padding = {
  btnVertical: 14,
  inputHorizontal: 16,
  cardHorizontal: 28,
} as const;

export const Radius = {
  xs: 2,
  sm: 8,
  md: 12,
  lg: 14,
  pill: 99,
} as const;

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
