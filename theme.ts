export const colors = {
  // Palette aligned to the vinyl-tornado logo: deep navy backgrounds
  // continue the splash-screen aesthetic into every screen, blue
  // primary matches the logo's dominant color (softened for UI
  // legibility), amber accent kept for warm party-game highlights.
  bg: '#00031C',
  surface: '#0B1130',
  surfaceAlt: '#131A3F',
  border: '#1F2A50',

  textPrimary: '#F5F5F7',
  textMuted: '#9CA8C4',

  primary: '#3B82F6',
  primaryHover: '#2563EB',
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
