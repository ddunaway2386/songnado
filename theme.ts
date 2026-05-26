export const colors = {
  bg: '#0B0B10',
  surface: '#16161F',
  surfaceAlt: '#1F1F2B',
  border: '#2A2A38',

  textPrimary: '#F5F5F7',
  textMuted: '#9A9AA8',

  primary: '#8B5CF6',
  primaryHover: '#7C3AED',
  accent: '#F59E0B',

  success: '#10B981',
  warning: '#F59E0B',
  danger: '#EF4444',
} as const;

export const radii = {
  sm: 6,
  md: 10,
  lg: 16,
  xl: 24,
  full: 9999,
} as const;

export type ThemeColor = keyof typeof colors;
