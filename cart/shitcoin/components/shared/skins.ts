// Skin presets — paired (variant, colors) for a 2021-era memecoin
// website. Each skin both flips the classifier variant (changing layout
// rules registered in `<Comp>.cls.ts`) AND swaps theme color tokens.
//
// One call (`applySkin(key)`) repaints the entire reusable component
// fleet because every component reads from the same theme tokens.

import type { ThemeColors, StylePalette } from '../../../../runtime/classifier';

export type SkinKey =
  | 'default'
  | 'uniswap'
  | 'pancake'
  | 'sushi'
  | 'dextools'
  | 'etherscan'
  | 'metamask'
  | 'phantom'
  | 'rabby'
  // OS skins for the Desktop.
  | 'xp'
  | 'win7'
  | 'macos'
  | 'linux'
  // Browser shell skins.
  | 'chrome'
  | 'brave'
  | 'firefox';

export type Skin = {
  variant: string;
  colors: Partial<ThemeColors>;
  styles?: Partial<StylePalette>;
};

export const SKINS: Record<SkinKey, Skin> = {
  default: {
    variant: 'default',
    colors: {},
  },

  // DEX skins
  uniswap: {
    variant: 'uniswap',
    colors: {
      bg: '#191b1f',
      bgAlt: '#0d111c',
      bgElevated: '#212429',
      surface: '#212429',
      surfaceHover: '#2c2f36',
      border: '#2c2f36',
      borderFocus: '#ff007a',
      text: '#ffffff',
      textSecondary: '#c3c5cb',
      textDim: '#888d9b',
      primary: '#ff007a',
      primaryHover: '#ff4b9d',
      primaryPressed: '#cc0061',
      accent: '#ff007a',
      success: '#27ae60',
      error: '#fd4040',
      warning: '#ff8f00',
      info: '#2172e5',
    },
    styles: { radiusMd: 16, radiusLg: 24 },
  },

  pancake: {
    variant: 'pancake',
    colors: {
      bg: '#27262c',
      bgAlt: '#1e1d22',
      bgElevated: '#353547',
      surface: '#27262c',
      surfaceHover: '#353547',
      border: '#383241',
      borderFocus: '#1fc7d4',
      text: '#f4eeff',
      textSecondary: '#b8add2',
      textDim: '#7a6eaa',
      primary: '#1fc7d4',
      primaryHover: '#33e1ed',
      primaryPressed: '#0094a8',
      accent: '#fcc631',
      success: '#31d0aa',
      error: '#ed4b9e',
      warning: '#fcc631',
      info: '#1fc7d4',
    },
    styles: { radiusMd: 16, radiusLg: 24 },
  },

  sushi: {
    variant: 'sushi',
    colors: {
      bg: '#0d0415',
      bgAlt: '#1a1023',
      bgElevated: '#26193b',
      surface: '#19112a',
      surfaceHover: '#251a3e',
      border: '#2e1f47',
      borderFocus: '#7b3fe4',
      text: '#fafafa',
      textSecondary: '#bfb6cf',
      textDim: '#7c7290',
      primary: '#0993ec',
      primaryHover: '#4ab2f6',
      primaryPressed: '#0675c2',
      accent: '#fa52a0',
      success: '#7cff6b',
      error: '#ff5b5b',
      warning: '#ffd166',
      info: '#0993ec',
    },
    styles: { radiusMd: 10, radiusLg: 14 },
  },

  dextools: {
    variant: 'dextools',
    colors: {
      bg: '#101218',
      bgAlt: '#171a23',
      bgElevated: '#1e222d',
      surface: '#1a1d27',
      surfaceHover: '#252935',
      border: '#272d3a',
      borderFocus: '#41a8ff',
      text: '#e1e6ef',
      textSecondary: '#9aa3b5',
      textDim: '#5d6678',
      primary: '#41a8ff',
      primaryHover: '#65bcff',
      primaryPressed: '#2685dc',
      accent: '#ffce4b',
      success: '#3ddc97',
      error: '#ff5573',
      warning: '#ffb056',
      info: '#41a8ff',
    },
    styles: { radiusSm: 2, radiusMd: 4, radiusLg: 6, fontSm: 10, fontMd: 12, fontLg: 16 },
  },

  etherscan: {
    variant: 'etherscan',
    colors: {
      bg: '#ffffff',
      bgAlt: '#f8f9fa',
      bgElevated: '#ffffff',
      surface: '#ffffff',
      surfaceHover: '#f1f3f5',
      border: '#dee2e6',
      borderFocus: '#21325b',
      text: '#212529',
      textSecondary: '#495057',
      textDim: '#6c757d',
      primary: '#21325b',
      primaryHover: '#2a4477',
      primaryPressed: '#16223e',
      accent: '#0784c3',
      success: '#28a745',
      error: '#dc3545',
      warning: '#ffc107',
      info: '#17a2b8',
    },
    styles: { radiusSm: 2, radiusMd: 4, radiusLg: 6 },
  },

  // Wallet skins
  metamask: {
    variant: 'metamask',
    colors: {
      bg: '#24272a',
      bgAlt: '#1b1d1f',
      bgElevated: '#2e3033',
      surface: '#24272a',
      surfaceHover: '#33373a',
      border: '#3b4044',
      borderFocus: '#037dd6',
      text: '#f6f7f9',
      textSecondary: '#bbc0c5',
      textDim: '#848c96',
      primary: '#037dd6',
      primaryHover: '#1098fc',
      primaryPressed: '#0260a4',
      accent: '#f6851b',
      success: '#28a745',
      error: '#d73a49',
      warning: '#f6851b',
      info: '#037dd6',
    },
    styles: { radiusMd: 8, radiusLg: 12 },
  },

  phantom: {
    variant: 'phantom',
    colors: {
      bg: '#181a23',
      bgAlt: '#13141a',
      bgElevated: '#222431',
      surface: '#1c1d28',
      surfaceHover: '#262838',
      border: '#2d2f3f',
      borderFocus: '#ab9ff2',
      text: '#ffffff',
      textSecondary: '#bdbfd0',
      textDim: '#7a7e94',
      primary: '#ab9ff2',
      primaryHover: '#c1b6ff',
      primaryPressed: '#8e80d4',
      accent: '#ab9ff2',
      success: '#14f195',
      error: '#ff5b5b',
      warning: '#ffd166',
      info: '#9945ff',
    },
    styles: { radiusMd: 12, radiusLg: 18 },
  },

  rabby: {
    variant: 'rabby',
    colors: {
      bg: '#1c2030',
      bgAlt: '#15182a',
      bgElevated: '#252a3d',
      surface: '#1c2030',
      surfaceHover: '#2a304a',
      border: '#2d3552',
      borderFocus: '#7084ff',
      text: '#e7eaff',
      textSecondary: '#a6acc8',
      textDim: '#6c7596',
      primary: '#7084ff',
      primaryHover: '#8a9cff',
      primaryPressed: '#5667d2',
      accent: '#7084ff',
      success: '#27c93f',
      error: '#ec5b5b',
      warning: '#ffaa3a',
      info: '#7084ff',
    },
    styles: { radiusMd: 6, radiusLg: 10 },
  },

  // OS skins for Desktop
  xp: {
    variant: 'xp',
    colors: {
      bg: '#3b6ea5',
      bgAlt: '#578bcb',
      bgElevated: '#ece9d8',
      surface: '#ece9d8',
      surfaceHover: '#f5f3e9',
      border: '#0054e3',
      borderFocus: '#316ac5',
      text: '#000000',
      textSecondary: '#3a3a3a',
      textDim: '#666666',
      primary: '#0054e3',
      primaryHover: '#3372e5',
      primaryPressed: '#003d9e',
      accent: '#ffcc00',
      success: '#00a500',
      error: '#cc0000',
      warning: '#ffaa00',
      info: '#3372e5',
    },
    styles: { radiusSm: 4, radiusMd: 6, radiusLg: 8, fontSm: 11, fontMd: 12, fontLg: 14 },
  },

  win7: {
    variant: 'win7',
    colors: {
      bg: '#3a6c9e',
      bgAlt: '#5a8bbe',
      bgElevated: '#dfe8f3',
      surface: '#dfe8f3',
      surfaceHover: '#ebf0fa',
      border: '#637998',
      borderFocus: '#3399ff',
      text: '#1a1a1a',
      textSecondary: '#3d3d3d',
      textDim: '#666666',
      primary: '#3399ff',
      primaryHover: '#57aaff',
      primaryPressed: '#2274cc',
      accent: '#ffcc00',
      success: '#28a745',
      error: '#cc0000',
      warning: '#ffaa00',
      info: '#3399ff',
    },
    styles: { radiusSm: 4, radiusMd: 8, radiusLg: 12, fontSm: 11, fontMd: 12, fontLg: 14 },
  },

  macos: {
    variant: 'macos',
    colors: {
      bg: '#1a1a1a',
      bgAlt: '#222222',
      bgElevated: '#2e2e2e',
      surface: '#28282b',
      surfaceHover: '#34343a',
      border: '#3a3a3c',
      borderFocus: '#0a84ff',
      text: '#f5f5f7',
      textSecondary: '#c7c7cc',
      textDim: '#8e8e93',
      primary: '#0a84ff',
      primaryHover: '#409cff',
      primaryPressed: '#0760c2',
      accent: '#ff453a',
      success: '#30d158',
      error: '#ff453a',
      warning: '#ff9f0a',
      info: '#0a84ff',
    },
    styles: { radiusSm: 6, radiusMd: 10, radiusLg: 14 },
  },

  linux: {
    variant: 'linux',
    colors: {
      bg: '#2c2828',
      bgAlt: '#23201f',
      bgElevated: '#3d3838',
      surface: '#322e2d',
      surfaceHover: '#403a39',
      border: '#48413f',
      borderFocus: '#e95420',
      text: '#f7f5f2',
      textSecondary: '#c8c0b8',
      textDim: '#807870',
      primary: '#e95420',
      primaryHover: '#f0703e',
      primaryPressed: '#c44616',
      accent: '#aea79f',
      success: '#37b24d',
      error: '#e95420',
      warning: '#ffaa00',
      info: '#3399cc',
    },
    styles: { radiusSm: 2, radiusMd: 4, radiusLg: 6 },
  },

  // Browser-chrome skins
  chrome: {
    variant: 'chrome',
    colors: { primary: '#1a73e8', accent: '#34a853' },
  },
  brave: {
    variant: 'brave',
    colors: { primary: '#fb542b', accent: '#ffb45a' },
  },
  firefox: {
    variant: 'firefox',
    colors: { primary: '#ff7139', accent: '#9059ff' },
  },
};

/** Map a `chain` enum (from `StakingPool.chain` or token chain) to the
 *  dapp skin most associated with that chain. Used by site components
 *  that show pools from multiple chains and want each row to look
 *  right. */
export function skinForChain(chain: number): SkinKey {
  // 0..12 enum order from framework/sim/basecoin.zig: bitcoin, ethereum,
  // bsc, solana, avalanche, fantom, polygon, arbitrum, base, tron,
  // cardano, litecoin, monero.
  switch (chain) {
    case 1: return 'uniswap';    // ethereum
    case 2: return 'pancake';    // bsc
    case 3: return 'phantom';    // solana
    case 7: return 'sushi';      // arbitrum
    case 8: return 'uniswap';    // base
    default: return 'dextools';
  }
}
