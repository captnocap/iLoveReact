// theme.ts — single source of truth for composer cart colors + sizes.
//
// Cart code references these names instead of inlining hex codes so a
// future theme swap is one-file. Same convention as cart/cutout/theme.ts.

export const COLORS = {
  bg: '#0b0d14',
  bgSoft: '#10131c',
  panel: '#141826',
  panelAlt: '#1b2032',
  panelHi: '#252b42',
  border: '#262d44',
  borderStrong: '#37416a',
  ink: '#ecf0fa',
  inkDim: '#8a98b8',
  inkMuted: '#5f6b88',
  accent: '#7c9aff',
  accentDim: '#4862c4',
  good: '#41d39a',
  warn: '#ffa84d',
  bad: '#ff5860',
  // Editor surface
  editor: '#0b0d14',
  editorGutter: '#10131c',
  editorCaret: '#a3c0ff',
  selection: '#2b3a6c',
  // Syntax tokens (referenced via highlight.ts:tokenColor)
  tokKeyword: '#c898ff',  // const / let / function / return / if / else …
  tokBuiltin: '#7c9aff',  // sandbox API: setTempo, makeBeat, loadSound …
  tokSynth:   '#41d39a',  // built-in synths: kick / snare / hat / bass / lead
  tokString:  '#ffa84d',  // 'literal', "literal", `literal`
  tokNumber:  '#67d9d4',  // 120, 0.5, -1
  tokComment: '#5f6b88',  // // line comments (same as inkMuted on purpose)
  tokPunct:   '#8a98b8',  // ( ) { } ; , .  (inkDim)
  tokText:    '#ecf0fa',  // anything else — same as ink
};

export const SIZES = {
  topBar: 44,
  statusBar: 28,
  libraryRail: 220,
  timelineBar: 96,
};
