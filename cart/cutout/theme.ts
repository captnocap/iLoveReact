// Single source of truth for cutout cart colors + sizes. Components
// reference these names instead of inlining hex codes so a future theme
// swap is one-file.

export const COLORS = {
  bg: '#0b1018',
  bgSoft: '#0f1522',
  panel: '#11182a',
  panelAlt: '#1a2332',
  panelHi: '#223047',
  border: '#2a3450',
  borderStrong: '#3a4a6c',
  ink: '#e8eef8',
  inkDim: '#7f93b1',
  inkMuted: '#5f718f',
  accent: '#3da9ff',
  good: '#34d399',
  warn: '#ff9f43',
  bad: '#ff4040',
};

export const SIZES = {
  titleBar: 34,
  actionBar: 40,
  topBar: 74,
  bottomBar: 36,
  toolPalette: 86,
  inspector: 288,
};
