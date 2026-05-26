// 3D palette — derived from the canonical render/palette.ts tile/neon numbers so
// the meshed city reads as the same neon-dusk world the 2D shader painted. RGB
// 0..1 tuples become hex because Scene3D.Mesh materials take hex strings.

import { TILE, NEON, type RGB } from '../render/palette';

export function hex(c: RGB): string {
  const to = (v: number) => Math.max(0, Math.min(255, Math.round(v * 255)))
    .toString(16)
    .padStart(2, '0');
  return `#${to(c[0])}${to(c[1])}${to(c[2])}`;
}

// Scale an rgb tuple (brighten roofs, darken side walls) before hexing.
function scale(c: RGB, k: number): RGB {
  return [c[0] * k, c[1] * k, c[2] * k] as RGB;
}

// Ground zone fills, keyed by tile KIND (citymap T enum order). Lifted off the
// 2D-shader tones because a meshed floor under dusk lighting reads much darker
// than an emissive shader quad — these are brightened so the city floor is
// legible at night without losing the neon-dusk register.
export const ZONE_HEX = {
  road: hex(scale(TILE.road, 2.4)),
  sidewalk: hex(scale(TILE.sidewalk, 1.9)),
  plaza: hex(scale(TILE.plaza, 1.7)),
  water: hex(scale(TILE.water, 1.7)),
  sand: hex(scale(TILE.sand, 1.5)),
  grime: hex(scale(TILE.grime, 2.1)),
} as const;

// Facade + roof per building style (0 pink stucco, 1 teal, 2 lilac, 3 grime).
// Pulled toward the stucco wall base with a per-style hue push.
const FACADE: RGB[] = [
  [0.40, 0.22, 0.30], // 0 pink stucco
  [0.18, 0.34, 0.36], // 1 teal
  [0.34, 0.26, 0.46], // 2 lilac
  [0.13, 0.12, 0.11], // 3 grime
];

export const buildingFacade = (style: number) => hex(FACADE[style] ?? FACADE[0]);
export const buildingRoof = (style: number) => hex(scale(FACADE[style] ?? FACADE[0], 1.45));
// Lit window strips glow in the style's complementary neon.
export const windowGlow = (style: number) =>
  hex([NEON.cyan, NEON.pink, NEON.orange, NEON.purple][style] ?? NEON.cyan);
// Neon rim cage colour per style (the crisp edge outline the 2D shader had).
export const neonRim = (style: number) =>
  hex([NEON.pink, NEON.cyan, NEON.purple, NEON.orange][style] ?? NEON.pink);

// Ground texturing.
export const PLAZA_A = hex(scale(TILE.plaza, 1.7)); // checker square A
export const PLAZA_B = hex(scale(TILE.plaza, 2.9)); // brighter checker square B
export const ROAD_LINE = hex(TILE.roadLine);
// Hill structure: the cliff/retaining-wall sides of the raised plaza shelf.
export const HILL_SIDE = hex(scale(TILE.plaza, 1.2));

// Props.
export const PALM_TRUNK = '#3a2c1e';
export const PALM_FROND = '#1f7a4a';
export const DUMPSTER = '#2c3a2e';
export const DUMPSTER_LID = '#23302a';
export const SIGN_POLE = '#1a1620';
export const signNeon = (tint: number) =>
  hex([NEON.pink, NEON.cyan, NEON.purple, NEON.orange][tint] ?? NEON.pink);

// Doors: a leaf inset into the building face.
export const DOOR_LEAF = '#120d18';
export const DOOR_FRAME = '#ffae00';

// Characters.
export const SKIN = ['#caa07a', '#9a6a44', '#e0b489', '#7a5232'];
// NPC clothing ramp keyed by Ent.tint (0..5).
export const NPC_SHIRT = ['#b53a52', '#2f7f8f', '#7a5aa8', '#c08a3a', '#4a8a52', '#c45a8a'];
export const NPC_PANTS = ['#26222e', '#1e2a30', '#241f30', '#2e2618', '#1c2a1e', '#2e1f2a'];
export const EYE = '#0a0a10';
export const BODY_DOWN = '#5a4250'; // a downed NPC, desaturated

// Path markers + click target.
export const PATH_DOT = hex(NEON.cyan);
export const PATH_TARGET = hex(NEON.pink);
