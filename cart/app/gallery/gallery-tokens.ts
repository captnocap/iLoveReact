// Token-string union types for classifier defs.
//
// These mirror the categories defined in gallery-theme / themes/*. They're
// open string-unions: every concrete token plus a `(string & {})` escape
// hatch so unknown 'theme:foo' literals still compile but get autocomplete
// from the known set.
//
// Single source of truth for token NAMES — values live in the theme files
// and are pushed into the runtime store by gallery-theme.ts.

type _Open<T extends string> = T | (string & {});

// ── Spacing (cockpit themes) ─────────────────────────────────
export type SpaceToken = _Open<
  | 'theme:spaceX0' | 'theme:spaceX1' | 'theme:spaceX2' | 'theme:spaceX3'
  | 'theme:spaceX4' | 'theme:spaceX5' | 'theme:spaceX6' | 'theme:spaceX7'
  | 'theme:spaceX8'
>;

// ── Radius ───────────────────────────────────────────────────
export type RadiusToken = _Open<
  | 'theme:radiusSm' | 'theme:radiusMd' | 'theme:radiusLg' | 'theme:radiusXl'
  | 'theme:radiusPill' | 'theme:radiusRound'
>;

// ── Type sizes ───────────────────────────────────────────────
export type TypeToken = _Open<
  | 'theme:typeMicro' | 'theme:typeTiny' | 'theme:typeCaption' | 'theme:typeBody'
  | 'theme:typeBase' | 'theme:typeMeta' | 'theme:typeStrong' | 'theme:typeHeading'
>;

// ── Letter spacing ───────────────────────────────────────────
export type LetterSpacingToken = _Open<
  | 'theme:lsTight' | 'theme:lsNormal' | 'theme:lsWide' | 'theme:lsWider'
  | 'theme:lsWidest' | 'theme:lsUltra' | 'theme:lsBrand'
>;

// ── Chrome heights ───────────────────────────────────────────
export type ChromeToken = _Open<
  | 'theme:chromeTopbar' | 'theme:chromeStatusbar'
  | 'theme:chromeTileHead' | 'theme:chromeStrip'
>;

// ── Typography (fonts/lineHeight) ────────────────────────────
export type FontToken = _Open<'theme:fontMono' | 'theme:fontSans'>;

// ── Colors ───────────────────────────────────────────────────
// Color set varies by theme. We list the names referenced by the existing
// components.cls.ts surface; new themes can add tokens and they'll still
// type-check via the open-union escape.
export type ColorToken = _Open<
  // Surfaces
  | 'theme:bg' | 'theme:bg1' | 'theme:bg2' | 'theme:paper' | 'theme:paperInk'
  | 'theme:transparent'
  // Ink
  | 'theme:ink' | 'theme:inkDim' | 'theme:textDim' | 'theme:muted'
  // Lines / chrome
  | 'theme:rule' | 'theme:ruleStrong' | 'theme:gridDot' | 'theme:gridDotStrong'
  // Accents / signal
  | 'theme:accent' | 'theme:accentHot'
  | 'theme:ok' | 'theme:warn' | 'theme:err' | 'theme:flag' | 'theme:sys'
>;
