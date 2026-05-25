// The single source of the Scape palette — TONE.md's register: neon dusk, pastel
// stucco, chrome, sunset gradients on the surface; grime/squalor underneath. The
// prettiness should feel a little wrong (3 a.m., up for days).
//
// Tile/accent colors live as 0..1 rgb tuples so BOTH the ground shader and the
// minimap derive from the same numbers — they can never drift apart. Chrome lives
// as hex strings for the React HUD/chat surfaces. Never paste a raw color into a
// cart module; add a token here and reference it.

export type RGB = readonly [number, number, number];

// ── tile bases (dream ↔ squalor) ──────────────────────────────────────────────
export const TILE = {
  road: [0.055, 0.05, 0.085] as RGB, // wet asphalt, almost black-violet
  roadLine: [0.62, 0.55, 0.22] as RGB, // faded lane paint
  sidewalk: [0.15, 0.14, 0.19] as RGB, // dusk concrete
  plaza: [0.20, 0.07, 0.24] as RGB, // neon plaza base (checker glows on top)
  water: [0.05, 0.09, 0.20] as RGB, // canal at dusk
  sand: [0.30, 0.22, 0.25] as RGB, // dim beach, warm but dirty
  grime: [0.085, 0.075, 0.07] as RGB, // trap-house dirt, the squalor
  wall: [0.34, 0.22, 0.27] as RGB, // pastel stucco, dusk-dimmed
  wallTop: [0.46, 0.34, 0.40] as RGB,
} as const;

// ── neon accents (the dream pole) ─────────────────────────────────────────────
export const NEON = {
  pink: [1.0, 0.16, 0.55] as RGB, // magenta — the dominant sign color
  cyan: [0.12, 0.92, 0.86] as RGB,
  purple: [0.50, 0.24, 1.0] as RGB,
  orange: [1.0, 0.46, 0.20] as RGB, // sunset
} as const;

// dusk sky / fog beyond the city edge
export const HAZE: RGB = [0.055, 0.03, 0.10];

// ── WGSL helper ───────────────────────────────────────────────────────────────
/** Format an rgb tuple as a WGSL `vec3f(...)` literal for shader interpolation. */
export function wgsl(c: RGB): string {
  return `vec3f(${c[0]}, ${c[1]}, ${c[2]})`;
}

// ── chrome (React HUD / chat) ─────────────────────────────────────────────────
// Neon-on-black panels. Magenta primary, cyan secondary, sunset tertiary. Panels
// are near-black violet so the neon edges read like signage at night.
export const UI = {
  panelBg: '#0c0614ee',
  panelBgSoft: '#0c0614cc',
  border: '#ff2d95', // neon magenta
  borderDim: '#5a2150',
  borderCyan: '#18e0d8',
  text: '#ffd8ec', // hot-pink-tinted white
  textDim: '#9a7a94',
  textFaint: '#5e4a5a',
  accent: '#18e0d8', // cyan
  accent2: '#ff7a3c', // sunset orange
  high: '#ff2d95',
  userBubble: '#1a1030',
  npcBubble: '#1c0a22',
  // ── HUD readouts (the GTA chrome) ──
  money: '#5fe08c', // spring-green LED cash
  health: '#ff5ea0', // magenta heart
  armor: '#8a6cff', // purple armor heart
  ledShadow: '#070310', // hard drop-shadow behind every LED glyph
  star: '#18e0d8', // a lit wanted star
  starDim: '#3a2540', // an unlit wanted star
  surround: '#0b0618', // dial / icon-box ground (matches the shader fills below)
} as const;
