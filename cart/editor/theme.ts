// editor/theme.ts — the editor's theme tokens.
//
// The locked Shitty Games palette, cloned from the workspace mock (the style
// approach is fixed; raw colors live here, components reference 'theme:NAME').
import type { StylePalette, ThemeColors } from '../../runtime/classifier';

export const EDITOR_COLORS: Partial<ThemeColors> = {
  bg: '#070b10',
  bgAlt: '#0b1016',
  bgElevated: '#111a24',
  surface: '#0e141c',
  surfaceHover: '#14202b',
  border: '#202b36',
  borderSoft: '#16212b',
  borderFocus: '#44d4e8',
  text: '#edf5f7',
  textSecondary: '#b8c6d0',
  textDim: '#788692',
  textFaint: '#4e5d68',
  primary: '#42d9e8',
  primaryHover: '#7deaf4',
  primaryPressed: '#25aebd',
  accent: '#77dc9b',
  success: '#77dc9b',
  warning: '#f1bd58',
  error: '#ef8074',
  info: '#a99bff',
  controlBg: '#0a1118',
  controlBorder: '#26333f',
  cardBg: '#0b1219',
  segActiveBg: '#12333a',
  segActiveText: '#c9f9ff',
  stageBg: '#05090d',
};

export const EDITOR_STYLES: Partial<StylePalette> = {
  radiusSm: 2,
  radiusMd: 4,
  radiusLg: 6,
  spacingSm: 5,
  spacingMd: 8,
  spacingLg: 12,
  borderThin: 1,
  borderMedium: 2,
  fontXs: 8,
  fontSm: 9,
  fontMd: 10,
  fontLg: 11,
  fontXl: 13,
  fontHero: 18,
};
