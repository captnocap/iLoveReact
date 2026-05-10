import type { StylePalette, ThemeColors } from '../../runtime/theme';

export const APP_COLORS: Partial<ThemeColors> = {
  bg: '#0b1117',
  bgAlt: '#111a24',
  bgElevated: '#162231',
  surface: '#182432',
  surfaceHover: '#213247',
  border: '#2e4159',
  borderFocus: '#4ea1ff',
  text: '#eef5ff',
  textSecondary: '#b6c4d7',
  textDim: '#74849a',
  primary: '#4ea1ff',
  primaryHover: '#6fb4ff',
  primaryPressed: '#2f83df',
  accent: '#ffd166',
  success: '#72d391',
  warning: '#ffb86b',
  error: '#ff6b7a',
  info: '#77d7ff',
};

export const APP_STYLES: Partial<StylePalette> = {
  radiusSm: 4,
  radiusMd: 8,
  radiusLg: 12,
  spacingSm: 8,
  spacingMd: 14,
  spacingLg: 22,
  borderThin: 1,
  borderMedium: 2,
  fontSm: 12,
  fontMd: 14,
  fontLg: 20,
};
