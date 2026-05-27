// Cockpit themes — ported from tsz/carts/cockpit/theme/*.tcls.tsz.
// Each export is a full color map + design tokens, merged into ThemeProvider.
// Classifier lookups use `theme:<key>` (see style.cls.ts).

export type ThemeMap = Record<string, any>;

export const COCKPIT_DAWN: ThemeMap = {
  bg: '#1A1F2C',
  bgAlt: '#242A3A',
  bgRaised: '#2C3345',
  bgSunken: '#141822',
  bgFloat: '#2C3345',
  bgOverlay: 'rgba(20, 24, 34, 0.85)',
  bgTint: '#1E2330',

  textPrimary: '#E8ECEF',
  textSecondary: '#A0A8B5',
  textDim: '#6B7585',
  textAccent: '#7DD3FC',
  textOnAccent: '#1A1F2C',
  textDisabled: '#4A5263',
  textError: '#F87171',
  textWarning: '#FBBF24',
  textSuccess: '#34D399',
  textInfo: '#60A5FA',

  borderHair: '#2C3345',
  borderLight: '#2C3345',
  borderMid: '#3A4255',
  borderStrong: '#5C667A',
  borderFocus: '#7DD3FC',

  primary: '#7DD3FC',
  accent: '#C4B5FD',
  success: '#34D399',
  warning: '#FBBF24',
  error: '#F87171',
  info: '#60A5FA',

  tier0: '#4A5263', tier1: '#BDB5F8', tier2: '#FDE68A', tier3: '#FDBA74', tier4: '#F9A8D4',

  spaceXxs: 2, spaceXs: 4, spaceSm: 8, spaceMd: 12,
  spaceLg: 16, spaceXl: 24, spaceXxl: 32, spaceHuge: 48,
  radiusNone: 0, radiusXs: 2, radiusSm: 4, radiusMd: 6,
  radiusLg: 10, radiusXl: 16, radiusFull: 9999,
  borderW0: 0, borderW1: 1, borderW2: 2, borderW3: 3, borderW4: 4,
  fontXxs: 9, fontXs: 10, fontSm: 11, fontMd: 13,
  fontLg: 15, fontXl: 18, fontXxl: 22, fontHuge: 28,
};

export const COCKPIT_DUSK: ThemeMap = {
  bg: '#1E2229',
  bgAlt: '#262B33',
  bgRaised: '#2D323C',
  bgSunken: '#181C22',
  bgFloat: '#2A2F38',
  bgOverlay: 'rgba(24, 28, 34, 0.75)',
  bgTint: '#23272E',

  textPrimary: '#E8EBF0',
  textSecondary: '#B0B8C4',
  textDim: '#7A8594',
  textAccent: '#D4A89C',
  textOnAccent: '#1E2229',
  textDisabled: '#5A6370',
  textError: '#D89B9B',
  textWarning: '#D4B87A',
  textSuccess: '#8BB8A6',
  textInfo: '#99B8C8',

  borderHair: '#2D323C',
  borderLight: '#333945',
  borderMid: '#4A5362',
  borderStrong: '#5A6370',
  borderFocus: '#D4A89C',

  primary: '#99B8C8',
  accent: '#D4A89C',
  success: '#8BB8A6',
  warning: '#D4B87A',
  error: '#D89B9B',
  info: '#99B8C8',

  tier0: '#5A6370', tier1: '#E8D5D0', tier2: '#D4B87A', tier3: '#C49A80', tier4: '#B89BAE',

  spaceXxs: 2, spaceXs: 4, spaceSm: 8, spaceMd: 12,
  spaceLg: 16, spaceXl: 24, spaceXxl: 32, spaceHuge: 48,
  radiusNone: 0, radiusXs: 2, radiusSm: 4, radiusMd: 6,
  radiusLg: 10, radiusXl: 16, radiusFull: 9999,
  borderW0: 0, borderW1: 1, borderW2: 2, borderW3: 3, borderW4: 4,
  fontXxs: 9, fontXs: 10, fontSm: 11, fontMd: 13,
  fontLg: 15, fontXl: 18, fontXxl: 22, fontHuge: 28,
};

export const COCKPIT_CLARITY: ThemeMap = {
  bg: '#FFFFFF',
  bgAlt: '#F7F2E0',
  bgRaised: '#FFFFFF',
  bgSunken: '#E4E1FC',
  bgFloat: '#FFFFFF',
  bgOverlay: 'rgba(54, 47, 66, 0.60)',
  bgTint: '#F4EEFC',

  textPrimary: '#000000',
  textSecondary: '#362F42',
  textDim: '#553D4E',
  textAccent: '#6B2FC9',
  textOnAccent: '#FFFFFF',
  textDisabled: '#A87965',
  textError: '#8E1A1A',
  textWarning: '#B38A00',
  textSuccess: '#1F7A4A',
  textInfo: '#0B6CB0',

  borderHair: '#A87965',
  borderLight: '#67474D',
  borderMid: '#362F42',
  borderStrong: '#000000',
  borderFocus: '#6B2FC9',

  primary: '#6B2FC9',
  accent: '#C21E6F',
  success: '#1F7A4A',
  warning: '#B38A00',
  error: '#8E1A1A',
  info: '#0B6CB0',

  tier0: '#67474D', tier1: '#9B6E6E', tier2: '#B38A00', tier3: '#D43A00', tier4: '#8E1A1A',

  spaceXxs: 2, spaceXs: 4, spaceSm: 8, spaceMd: 12,
  spaceLg: 16, spaceXl: 24, spaceXxl: 32, spaceHuge: 48,
  radiusNone: 0, radiusXs: 2, radiusSm: 4, radiusMd: 6,
  radiusLg: 10, radiusXl: 16, radiusFull: 9999,
  borderW0: 0, borderW1: 1, borderW2: 2, borderW3: 3, borderW4: 4,
  fontXxs: 9, fontXs: 10, fontSm: 11, fontMd: 13,
  fontLg: 15, fontXl: 18, fontXxl: 22, fontHuge: 28,
};

export const COCKPIT_BSOD: ThemeMap = {
  bg: '#0000AA',
  bgAlt: '#0000CC',
  bgRaised: '#1A1AB5',
  bgSunken: '#00008F',
  bgFloat: '#2A2ABF',
  bgOverlay: 'rgba(0, 0, 100, 0.70)',
  bgTint: '#1515B5',

  textPrimary: '#FFFFFF',
  textSecondary: '#E0E0FF',
  textDim: '#B8B8D8',
  textAccent: '#FFFF80',
  textOnAccent: '#0000AA',
  textDisabled: '#8888AA',
  textError: '#FF8080',
  textWarning: '#FFFF80',
  textSuccess: '#80FF80',
  textInfo: '#80FFFF',

  borderHair: '#B8B8D0',
  borderLight: '#B8B8D0',
  borderMid: '#D0D0E0',
  borderStrong: '#FFFFFF',
  borderFocus: '#FFFF80',

  primary: '#FFFF80',
  accent: '#FF80FF',
  success: '#80FF80',
  warning: '#FFFF80',
  error: '#FF8080',
  info: '#80FFFF',

  tier0: '#8888AA', tier1: '#D0D0E0', tier2: '#FFFF80', tier3: '#FFA040', tier4: '#FF4040',

  spaceXxs: 1, spaceXs: 2, spaceSm: 4, spaceMd: 8,
  spaceLg: 12, spaceXl: 16, spaceXxl: 24, spaceHuge: 32,
  radiusNone: 0, radiusXs: 0, radiusSm: 0, radiusMd: 0,
  radiusLg: 0, radiusXl: 0, radiusFull: 0,
  borderW0: 0, borderW1: 1, borderW2: 1, borderW3: 1, borderW4: 2,
  fontXxs: 9, fontXs: 10, fontSm: 11, fontMd: 12,
  fontLg: 14, fontXl: 16, fontXxl: 20, fontHuge: 24,
};

export const THEMES: ThemeMap[] = [COCKPIT_DAWN, COCKPIT_DUSK, COCKPIT_CLARITY, COCKPIT_BSOD];
export const THEME_NAMES = ['dawn', 'dusk', 'clarity', 'bsod'];
