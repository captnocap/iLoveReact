// theme — the hmsc-int studio palette. THE single home for these literals.
//
// Per the project's no-color-drift rule, hex/rgba values live ONLY here. The
// classifier sheet (studio.cls.ts) and every component reference `theme:NAME`
// tokens — never a raw colour. Reskinning the whole studio = editing this file.
//
// Seeded at the cart root via <ThemeProvider colors={STUDIO_COLORS} styles={STUDIO_STYLES}>.
// The 18 semantic colour tokens + 11 numeric style tokens are the standard set;
// the extras below (borderSoft, track, valNum, …) are studio-specific and ride
// the `[key:string]` escape hatch on ThemeColors / StylePalette.

import type { StylePalette, ThemeColors } from '../../runtime/classifier';

export const STUDIO_COLORS: Partial<ThemeColors> = {
  // ── surfaces (dark → elevated) ──────────────────────────────
  bg:           '#0d1218', // panel base
  bgAlt:        '#0a111d', // deepest — tree, AI feed
  bgElevated:   '#15233a', // active selection / hovered card target
  surface:      '#10161e', // header strips, hero band
  surfaceHover: '#10203a', // row hover

  // ── lines ───────────────────────────────────────────────────
  border:       '#26313c', // structural dividers, column edges
  borderSoft:   '#1b2530', // inner group dividers, field separators (extra)
  borderFocus:  '#39c5d8',

  // ── text ─────────────────────────────────────────────────────
  text:          '#eef2f4',
  textSecondary: '#c2cdd6',
  textDim:       '#6a7783', // field labels
  textFaint:     '#56646f', // counts, hints (extra)

  // ── brand + status (also the group-accent palette) ──────────
  primary:        '#39c5d8', // cyan
  primaryHover:   '#5cd3e3',
  primaryPressed: '#2aa6b8',
  accent:         '#39c5d8',
  accentTeal:     '#67c1d6', // a 6th group accent (extra)
  success:        '#7bd88f', // green
  warning:        '#f3bc54', // amber
  error:          '#ef7d73', // red
  info:           '#b89bff', // violet

  // ── control internals (extra — keeps drift out of components) ─
  controlBg:     '#101a22', // stepper / segment / chip body
  controlBorder: '#243039',
  cardBg:        '#0e151d',
  track:         '#1d2832', // slider track, divider on chips
  knob:          '#eef4f7', // slider knob
  onTrack:       '#1d3a27', // toggle ON track
  offTrack:      '#26323d', // toggle OFF track
  offKnob:       '#7a8895', // toggle OFF knob
  segActiveBg:   '#15303d', // segmented active cell
  segActiveText: '#bfeef5',
  valText:       '#cdd9e2', // slider / generic value text
  valNum:        '#f0e3c4', // numeric value (warm)

  // ── embodied HUD (extra — the Fortnite-verbatim game chrome, HUD-0605) ─
  hudPanel:      '#0b1220b8', // translucent HUD panel over the 3D scene
  hudPanelEdge:  '#26313c66', // soft translucent panel border
  hudText:       '#e6edf3',   // HUD primary text (reads over sky + ground)
  hudTextDim:    '#9fb0c4',   // HUD secondary
  hudHealth:     '#6fe08a',   // health bar fill (Fortnite green family)
  hudShield:     '#4aa8ff',   // shield bar fill (Fortnite blue family)
  hudBarTrack:   '#0a0f16cc', // bar track under fills
  hudMarker:     '#fbbf24',   // compass objective/target marker
  hudPlayer:     '#7dd3fc',   // minimap player blip
};

export const STUDIO_STYLES: Partial<StylePalette> = {
  // dense + sharp — the studio reads like an instrument, not an airy web app
  radiusSm: 2, radiusMd: 3, radiusLg: 6,
  spacingSm: 5, spacingMd: 8, spacingLg: 12,
  borderThin: 1, borderMedium: 2,
  fontSm: 9, fontMd: 10, fontLg: 11,
  // extras
  fontXs: 8, fontXl: 13, fontHero: 18,
};
