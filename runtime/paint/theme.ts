// runtime/paint/theme.ts — the paint kit's theme tokens. The kit is NOT
// coupled to any app's chrome (the old ColorWheel imported hmsc's GAME_CHROME);
// it ships a dark default and takes a PaintTheme override prop so it looks
// native wherever it's dropped.

export interface PaintTheme {
  /** deepest surface (canvas wells, shader backers) */
  page: string;
  /** panel / rail background */
  panel: string;
  /** input + control background */
  control: string;
  /** borders + dividers */
  frame: string;
  /** primary text + active fill */
  ink: string;
  /** secondary text */
  dim: string;
  /** selected / active accent */
  accent: string;
  /** error / invalid */
  bad: string;
}

export const DARK_THEME: PaintTheme = {
  page: '#0b1018',
  panel: '#141a24',
  control: '#1b2330',
  frame: '#2a3543',
  ink: '#e6edf6',
  dim: '#8a98ab',
  accent: '#3da9ff',
  bad: '#ff5d5d',
};

export const LIGHT_THEME: PaintTheme = {
  page: '#e9edf2',
  panel: '#f4f6f9',
  control: '#ffffff',
  frame: '#c7d0db',
  ink: '#1a2230',
  dim: '#5b6878',
  accent: '#2563eb',
  bad: '#d11f2f',
};
