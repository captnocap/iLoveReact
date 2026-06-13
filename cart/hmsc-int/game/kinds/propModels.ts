// game/kinds/propModels — prop part recipes AS DATA (PROPBATCH-0611).
//
// One recipe per prop kind, authored once and consumed by BOTH render paths:
//   • /test — render3d/props/DataProp.tsx converts each PropPartSpec into a
//     render3d/parts.tsx Part and draws it through TexturedParts, so every
//     recipe is click-to-pick texturable in the editor with zero extra code;
//   • the compiled game — compile/worldGeometry.ts lowers the same parts into
//     the static instance buffer (or the DYNAMIC_PROPS lump for kicked kinds).
//
// The vocabulary is the compiled loader's instance shapes (box / 8- and
// 16-segment cylinder / sphere), so a recipe can never use geometry the no-V8
// game cannot draw — /test and /compiled agree by construction. PSX-era
// chunkiness is the style contract: few parts, bold colors, rotated boxes for
// anything jagged. Sizes derive from the kind's registry definition
// (heightMeters / footprintRadiusMeters) wherever sane, so a scale edit in
// game/kinds/props.ts rescales the model.
//
// A part with `partId` is a FLAT IMAGE TARGET (req_0635 — "give it an image
// for the prop, basically just a flat"): /test offers it in the click-to-pick
// texture flow (WorldProp.partTextures[partId] = a TEXTURE_REGISTRY id), and
// the compile bake interns the id's shader/decal recipe as the part's
// material. An album cover, a poster, a business sign face — one thin box
// each, image-skinnable end to end.

import { propKindDefinition, type PropKind } from './props';
import { HMSC_SCALE } from '../../world/scale';

export type Color = readonly [number, number, number];
export type Rotation = readonly [number, number, number];
export type PropPartShape = 'box' | 'cylinder8' | 'cylinder16' | 'sphere';

export type PropPartSpec = {
  shape: PropPartShape;
  /** anchor-relative position (meters, y up from the ground anchor) */
  local: readonly [number, number, number];
  /** full extents — box [w,h,d]; cylinders [d, h, d]; sphere [dx,dy,dz] */
  size: readonly [number, number, number];
  color: Color;
  /** local rotation degrees; prop yaw composes on top */
  rotation?: Rotation;
  /** present = this part is a flat image target (partTextures key) */
  partId?: string;
};

export function box(local: readonly [number, number, number], size: readonly [number, number, number], color: Color, rotation?: Rotation): PropPartSpec {
  return { shape: 'box', local, size, color, rotation };
}

export function cylinder8(local: readonly [number, number, number], radius: number, height: number, color: Color, rotation?: Rotation): PropPartSpec {
  return { shape: 'cylinder8', local, size: [radius * 2, height, radius * 2], color, rotation };
}

export function cylinder16(local: readonly [number, number, number], radius: number, height: number, color: Color, rotation?: Rotation): PropPartSpec {
  return { shape: 'cylinder16', local, size: [radius * 2, height, radius * 2], color, rotation };
}

export function sphere(local: readonly [number, number, number], size: readonly [number, number, number], color: Color): PropPartSpec {
  return { shape: 'sphere', local, size, color };
}

/** A flat image-target panel: a thin box whose broad faces take a texture. */
function panel(partId: string, local: readonly [number, number, number], size: readonly [number, number, number], color: Color, rotation?: Rotation): PropPartSpec {
  return { shape: 'box', local, size, color, rotation, partId };
}

// The stable id a part is textured under — the key in WorldProp.partTextures.
// A panel keeps its own partId (an album cover's 'cover', a vending front's
// 'front'); every OTHER part falls back to its index in the recipe
// ('part0','part1',…) so EVERY part of a data-recipe prop is a texture target,
// not just the image panels (req_0757, "props in general"). The /test preview
// (render3d/props/DataProp) and the compile bake (compile/worldGeometry) MUST
// derive ids identically — otherwise a baked texture lands on the wrong mesh —
// so this one helper is the single source of truth both sides call.
export function propPartId(spec: PropPartSpec, index: number): string {
  return spec.partId ?? `part${index}`;
}

export function hx(hex: string): Color {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16);
  return [((n >> 16) & 0xff) / 255, ((n >> 8) & 0xff) / 255, (n & 0xff) / 255];
}

export function cssColor(color: Color): string {
  const channel = (v: number) => Math.max(0, Math.min(255, Math.round(v * 255))).toString(16).padStart(2, '0');
  return `#${channel(color[0])}${channel(color[1])}${channel(color[2])}`;
}

// ── the shared palette ───────────────────────────────────────────────────────
const STONE = hx('#6b7079');
const STONE_DARK = hx('#52565d');
const STONE_LIGHT = hx('#82868d');
const METAL = hx('#3a3f46');
const STEEL = hx('#9aa1ab');
const STEEL_DARK = hx('#6c727b');
const RUST = hx('#8a4a32');
const WOOD = hx('#8a6240');
const WOOD_DARK = hx('#6b4a2e');
const WOOD_PALE = hx('#c2a878');
const CONCRETE = hx('#b9b6ae');
const NEAR_BLACK = hx('#1a1c1e');
const WHITE = hx('#eef0f2');
const GRASS_MID = hx('#3f7d33');
const GRASS_LIGHT = hx('#5a9a42');
const GRASS_DRY = hx('#8a9a4a');

// ── grass (req: "can u just make patches of grass also lol") ────────────────
// A tuft is two crossed thin boxes — the PSX foliage cross, flat-shaded.
function tuft(x: number, z: number, w: number, h: number, color: Color): PropPartSpec[] {
  return [
    box([x, h / 2, z], [w, h, 0.02], color, [0, 45, 0]),
    box([x, h / 2, z], [w, h, 0.02], color, [0, -45, 0]),
  ];
}

function grassParts(kind: PropKind): PropPartSpec[] {
  const def = propKindDefinition(kind);
  const r = def.footprintRadiusMeters;
  const h = def.heightMeters;
  const spots: [number, number, number, Color][] = [
    [0, 0, 1, GRASS_MID],
    [r * 0.55, r * 0.2, 0.8, GRASS_LIGHT],
    [-r * 0.5, -r * 0.3, 0.85, GRASS_MID],
    [r * 0.15, -r * 0.55, 0.7, GRASS_DRY],
    [-r * 0.3, r * 0.5, 0.75, GRASS_LIGHT],
  ];
  return spots.flatMap(([x, z, t, color]) => tuft(x, z, r * 0.55, h * t, color));
}

// ── recipes for every PROPBATCH kind ─────────────────────────────────────────
// Keyed by kind; a kind absent here uses worldGeometry's bespoke case (the
// pre-batch props) or the registry-box placeholder.
const RECIPES: Partial<Record<PropKind, () => PropPartSpec[]>> = {
  grassPatch: () => grassParts('grassPatch'),
  grassTall: () => {
    const parts = grassParts('grassTall');
    const def = propKindDefinition('grassTall');
    // seed heads poking above the tall tufts
    parts.push(sphere([def.footprintRadiusMeters * 0.3, def.heightMeters * 0.95, 0.1], [0.07, 0.12, 0.07], GRASS_DRY));
    parts.push(sphere([-def.footprintRadiusMeters * 0.25, def.heightMeters * 0.88, -0.15], [0.07, 0.12, 0.07], GRASS_DRY));
    return parts;
  },

  // jagged rock forms — rotated boxes give the sharp facets the sphere-blob
  // rocks can't (user: "more like jagged rocks")
  rockJagged: () => {
    const { heightMeters: h, footprintRadiusMeters: r } = propKindDefinition('rockJagged');
    return [
      box([0, h * 0.45, 0], [r * 1.5, h * 0.9, r * 1.2], STONE, [12, 25, -8]),
      box([r * 0.4, h * 0.3, -r * 0.3], [r * 0.9, h * 0.7, r * 0.8], STONE_DARK, [-15, 60, 10]),
      box([-r * 0.45, h * 0.35, r * 0.25], [r * 0.8, h * 0.8, r * 0.7], STONE_LIGHT, [8, -35, -18]),
      box([r * 0.1, h * 0.8, r * 0.1], [r * 0.6, h * 0.55, r * 0.5], STONE, [22, 45, 15]),
    ];
  },
  rockShard: () => {
    const { heightMeters: h, footprintRadiusMeters: r } = propKindDefinition('rockShard');
    return [
      box([0, h * 0.5, 0], [r * 1.1, h * 1.0, r * 0.9], STONE, [4, 15, -6]),
      box([r * 0.35, h * 0.38, r * 0.2], [r * 0.8, h * 0.76, r * 0.7], STONE_DARK, [-8, 50, 9]),
      box([-r * 0.3, h * 0.42, -r * 0.25], [r * 0.7, h * 0.85, r * 0.6], STONE_LIGHT, [10, -30, -12]),
      box([0, h * 0.1, 0], [r * 1.8, h * 0.2, r * 1.5], STONE_DARK, [0, 30, 0]),
    ];
  },

  // ── broadcast / street commerce ────────────────────────────────────────────
  radioTower: () => {
    const { heightMeters: h, footprintRadiusMeters: r } = propKindDefinitionStrict('radioTower');
    const latticeTop = h * 0.88;
    const baseHalf = r * 0.82;
    const topHalf = r * 0.16;
    const red = hx('#c2362f');
    const parts: PropPartSpec[] = [];
    const segments = 3;
    for (let i = 0; i < segments; i += 1) {
      const y0 = (latticeTop * i) / segments;
      const segH = latticeTop / segments;
      const half = baseHalf + (topHalf - baseHalf) * ((i + 0.5) / segments);
      const paint = i % 2 === 0 ? red : WHITE;
      for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]] as const) {
        parts.push(box([half * sx, y0 + segH / 2, half * sz], [0.2, segH, 0.2], paint));
      }
      // brace frame at the segment top
      parts.push(box([0, y0 + segH, 0], [half * 2 + 0.2, 0.14, 0.14], STEEL_DARK));
      parts.push(box([0, y0 + segH, 0], [0.14, 0.14, half * 2 + 0.2], STEEL_DARK));
    }
    parts.push(cylinder8([0, latticeTop + (h - latticeTop) / 2, 0], 0.09, h - latticeTop, STEEL));
    parts.push(sphere([0, h, 0], [0.5, 0.5, 0.5], hx('#ff3b30'))); // aviation beacon
    return parts;
  },
  gasPump: () => {
    const s = propKindDefinitionStrict('gasPump').heightMeters / 2.1;
    const cream = hx('#e8e4da');
    const red = hx('#c1272d');
    return [
      box([0, 0.05 * s, 0], [0.8 * s, 0.1 * s, 0.5 * s], CONCRETE),
      box([0, 0.72 * s, 0], [0.62 * s, 1.25 * s, 0.42 * s], cream),
      box([0, 1.1 * s, -0.21 * s], [0.5 * s, 0.5 * s, 0.02 * s], NEAR_BLACK),
      box([0, 1.45 * s, 0], [0.64 * s, 0.18 * s, 0.44 * s], red),
      box([0, 1.58 * s, 0], [0.68 * s, 0.12 * s, 0.46 * s], cream),
      cylinder8([0.34 * s, 0.95 * s, 0], 0.03 * s, 0.75 * s, NEAR_BLACK, [0, 0, 14]),
      box([0.38 * s, 0.52 * s, 0], [0.09 * s, 0.2 * s, 0.09 * s], red),
    ];
  },
  vendingMachine: () => {
    const s = propKindDefinitionStrict('vendingMachine').heightMeters / 2.1;
    const red = hx('#c1272d');
    const redDark = hx('#8e1d22');
    return [
      box([0, 1.02 * s, 0.02 * s], [0.94 * s, 2.0 * s, 0.78 * s], red),
      box([-0.32 * s, 0.06 * s, -0.3 * s], [0.12 * s, 0.12 * s, 0.12 * s], NEAR_BLACK),
      box([0.32 * s, 0.06 * s, -0.3 * s], [0.12 * s, 0.12 * s, 0.12 * s], NEAR_BLACK),
      // the brandable front — image target (req_0635)
      panel('front', [0, 1.12 * s, -0.38 * s], [0.86 * s, 1.7 * s, 0.03 * s], redDark),
      // display window + coin column + dispense slot ride proud of the panel
      box([-0.16 * s, 1.35 * s, -0.4 * s], [0.46 * s, 1.1 * s, 0.02 * s], hx('#15314e')),
      box([0.28 * s, 1.5 * s, -0.4 * s], [0.16 * s, 0.4 * s, 0.02 * s], METAL),
      box([0, 0.42 * s, -0.4 * s], [0.6 * s, 0.24 * s, 0.03 * s], NEAR_BLACK),
    ];
  },
  storeShelf: () => {
    const def = propKindDefinitionStrict('storeShelf');
    const span = def.footprintRadiusMeters * 2;
    const h = def.heightMeters;
    const goods: Color[] = [hx('#d8a23a'), hx('#3a8fd8'), hx('#c14d4d'), hx('#56a85c'), hx('#b06fc4'), hx('#e0e0d4')];
    const parts: PropPartSpec[] = [
      box([0, 0.06, 0], [span, 0.12, 0.6], STEEL_DARK),
      box([0, h / 2, 0.26], [span, h - 0.08, 0.05], STEEL),
      box([-span / 2 + 0.03, h / 2, 0], [0.06, h, 0.58], STEEL_DARK),
      box([span / 2 - 0.03, h / 2, 0], [0.06, h, 0.58], STEEL_DARK),
    ];
    const shelfYs = [h * 0.3, h * 0.55, h * 0.8];
    shelfYs.forEach((y, row) => {
      parts.push(box([0, y, 0], [span - 0.12, 0.05, 0.55], STEEL));
      for (let i = 0; i < 3; i += 1) {
        const x = (i - 1) * span * 0.28;
        parts.push(box([x, y + 0.16, -0.05], [span * 0.2, 0.26, 0.35], goods[(row * 3 + i) % goods.length]));
      }
    });
    return parts;
  },
  crate: () => {
    const s = propKindDefinitionStrict('crate').heightMeters / 0.65;
    return [
      box([0, 0.31 * s, 0], [0.62 * s, 0.58 * s, 0.62 * s], WOOD),
      box([0, 0.12 * s, 0], [0.65 * s, 0.1 * s, 0.65 * s], WOOD_DARK),
      box([0, 0.5 * s, 0], [0.65 * s, 0.1 * s, 0.65 * s], WOOD_DARK),
      box([0, 0.61 * s, 0], [0.64 * s, 0.04 * s, 0.2 * s], WOOD_PALE),
      box([0, 0.61 * s, 0], [0.2 * s, 0.04 * s, 0.64 * s], WOOD_PALE),
    ];
  },
  pallet: () => {
    const parts: PropPartSpec[] = [];
    for (const z of [-0.5, 0, 0.5]) parts.push(box([0, 0.045, z], [1.2, 0.08, 0.1], WOOD_DARK));
    for (let i = 0; i < 5; i += 1) parts.push(box([(i - 2) * 0.27, 0.12, 0], [0.2, 0.05, 1.2], WOOD_PALE));
    return parts;
  },
  palletStack: () => {
    const parts: PropPartSpec[] = [];
    const jitter = [0.03, -0.04, 0.02, -0.02, 0.04, 0];
    for (let i = 0; i < 6; i += 1) {
      const y = 0.08 + i * 0.165;
      parts.push(box([jitter[i], y, jitter[5 - i]], [1.2, 0.07, 1.2], i % 2 === 0 ? WOOD_PALE : WOOD));
      parts.push(box([jitter[i], y - 0.06, jitter[5 - i]], [1.1, 0.06, 0.1], WOOD_DARK));
    }
    return parts;
  },
  businessSign: () => {
    const cream = hx('#f4f1e8');
    return [
      box([0, 0.53, -0.13], [0.66, 1.06, 0.04], cream, [-12, 0, 0]),
      box([0, 0.53, 0.13], [0.66, 1.06, 0.04], hx('#d8d2c2'), [12, 0, 0]),
      box([0, 1.05, 0], [0.66, 0.05, 0.1], WOOD_DARK),
      // the sandwich-board face — image target
      panel('face', [0, 0.56, -0.155], [0.56, 0.82, 0.012], hx('#2e6fb0'), [-12, 0, 0]),
    ];
  },
  shopSign: () => {
    const h = propKindDefinitionStrict('shopSign').heightMeters;
    return [
      box([0, h - 0.1, -0.4], [0.07, 0.07, 0.85], METAL),
      box([0, h - 0.32, -0.62], [0.02, 0.4, 0.02], STEEL_DARK),
      box([0, h - 0.32, -0.42], [0.02, 0.4, 0.02], STEEL_DARK),
      // the hanging blade — image target
      panel('face', [0, h - 0.78, -0.52], [0.78, 0.52, 0.04], hx('#7a4a8a')),
    ];
  },
  poster: () => [
    box([0, 1.55, -0.02], [0.96, 1.36, 0.015], hx('#3a3a3a')),
    // the poster sheet — image target (req_0635 "basically just a flat")
    panel('face', [0, 1.55, -0.035], [0.9, 1.3, 0.012], hx('#3f7d8a')),
  ],
  hospitalSign: () => {
    const red = hx('#c1272d');
    return [
      box([0, 2.7, -0.05], [2.6, 0.8, 0.1], WHITE),
      box([-0.95, 2.7, -0.115], [0.16, 0.52, 0.025], red),
      box([-0.95, 2.7, -0.115], [0.52, 0.16, 0.025], red),
      box([0.35, 2.7, -0.115], [1.5, 0.34, 0.02], hx('#15314e')),
    ];
  },
  policeSign: () => [
    box([0, 2.7, -0.05], [2.4, 0.7, 0.1], hx('#16365c')),
    box([0.2, 2.7, -0.11], [1.4, 0.3, 0.02], WHITE),
    cylinder8([-0.85, 2.7, -0.11], 0.2, 0.03, hx('#d8b23a'), [90, 0, 0]),
  ],

  // ── music / media (surface-mount tabletop props) ───────────────────────────
  bookStack: () => {
    const covers: Color[] = [hx('#7a3b2a'), hx('#2e6f55'), hx('#3a5a8a'), hx('#a8893a')];
    const parts = covers.map((color, i) =>
      box([(i % 2) * 0.03 - 0.015, 0.04 + i * 0.075, (i % 3) * 0.02 - 0.02], [0.32, 0.07, 0.22], color, [0, (i * 17) % 30 - 15, 0]));
    parts.push(box([0.05, 0.34, 0], [0.3, 0.065, 0.21], hx('#8a3b5a'), [0, 24, 8]));
    return parts;
  },
  recordPlayer: () => [
    box([0, 0.07, 0], [0.5, 0.14, 0.4], WOOD),
    cylinder16([-0.03, 0.16, 0], 0.16, 0.035, NEAR_BLACK),
    cylinder16([-0.03, 0.185, 0], 0.15, 0.012, hx('#111214')),
    cylinder8([-0.03, 0.2, 0], 0.045, 0.014, hx('#c14d4d')),
    box([0.19, 0.18, 0.08], [0.025, 0.02, 0.2], STEEL, [0, -25, 0]),
  ],
  vinylRecord: () => [
    cylinder16([0, 0.02, 0], 0.18, 0.015, hx('#111214')),
    cylinder8([0, 0.032, 0], 0.05, 0.012, hx('#d8762a')),
  ],
  albumCover: () => [
    // the sleeve, standing with a lean — its face IS the prop (req_0635)
    panel('cover', [0, 0.18, 0], [0.36, 0.36, 0.025], hx('#7a4a8a'), [-8, 0, 0]),
    box([0, 0.02, 0.02], [0.36, 0.03, 0.05], hx('#4a2a55')),
  ],
  speaker: () => {
    const h = propKindDefinitionStrict('speaker').heightMeters;
    return [
      box([0, h * 0.5, 0], [0.42, h, 0.35], hx('#23262a')),
      cylinder16([0, h * 0.32, -0.165], 0.14, 0.04, hx('#101113'), [90, 0, 0]),
      sphere([0, h * 0.32, -0.18], [0.1, 0.1, 0.05], hx('#34383d')),
      cylinder8([0, h * 0.75, -0.165], 0.06, 0.035, hx('#101113'), [90, 0, 0]),
    ];
  },
  speakerStack: () => {
    const h = propKindDefinitionStrict('speakerStack').heightMeters;
    const cab = hx('#23262a');
    const cone = hx('#101113');
    return [
      box([0, h * 0.27, 0], [0.9, h * 0.54, 0.62], cab),
      box([0, h * 0.77, 0], [0.78, h * 0.44, 0.55], cab),
      cylinder16([-0.2, h * 0.27, -0.295], 0.17, 0.04, cone, [90, 0, 0]),
      cylinder16([0.2, h * 0.27, -0.295], 0.17, 0.04, cone, [90, 0, 0]),
      cylinder16([0, h * 0.7, -0.26], 0.14, 0.04, cone, [90, 0, 0]),
      box([0, h * 0.9, -0.26], [0.4, 0.14, 0.04], hx('#34383d')),
    ];
  },
  cassette: () => [
    box([0, 0.008, 0], [0.1, 0.014, 0.064], hx('#2a2d33')),
    box([0, 0.017, 0], [0.07, 0.004, 0.04], hx('#d8d2c2')),
  ],

  // ── the junkyard set (reference image) ─────────────────────────────────────
  shippingContainer: () => {
    const def = propKindDefinitionStrict('shippingContainer');
    const len = def.footprintRadiusMeters * 2;
    const h = def.heightMeters;
    const w = 2.8;
    const body = hx('#8a3324');
    const dark = hx('#6e2818');
    const parts: PropPartSpec[] = [
      box([0, h / 2, 0], [len, h - 0.1, w - 0.12], body),
      box([0, h - 0.04, 0], [len, 0.08, w], dark),
      box([0, 0.05, 0], [len, 0.1, w], dark),
    ];
    // side corrugation ridges
    for (const sz of [-1, 1]) {
      parts.push(box([0, h * 0.35, sz * (w / 2 - 0.03)], [len - 0.3, 0.16, 0.07], dark));
      parts.push(box([0, h * 0.7, sz * (w / 2 - 0.03)], [len - 0.3, 0.16, 0.07], dark));
    }
    // door end: two leaves + lock rods
    parts.push(box([len / 2 - 0.02, h / 2, -w / 4 + 0.03], [0.08, h - 0.2, w / 2 - 0.12], dark));
    parts.push(box([len / 2 - 0.02, h / 2, w / 4 - 0.03], [0.08, h - 0.2, w / 2 - 0.12], dark));
    for (const z of [-0.95, -0.45, 0.45, 0.95]) parts.push(box([len / 2 + 0.04, h / 2, z], [0.05, h - 0.4, 0.06], STEEL_DARK));
    return parts;
  },
  concretePipe: () => {
    const def = propKindDefinitionStrict('concretePipe');
    const radius = def.heightMeters / 2;
    const len = def.footprintRadiusMeters * 2 - 0.2;
    return [
      cylinder16([0, radius, 0], radius, len, CONCRETE, [0, 0, 90]),
      // a longer darker core pokes out both ends — the PSX fake bore
      cylinder16([0, radius, 0], radius * 0.78, len + 0.04, hx('#4a4843'), [0, 0, 90]),
      cylinder16([len / 2 - 0.12, radius, 0], radius * 1.06, 0.26, hx('#a8a59c'), [0, 0, 90]),
    ];
  },
  pipeStack: () => {
    const len = 3.4;
    const r = 0.17;
    const rows: [number, number, Color][] = [
      [-0.36, r, STEEL], [0, r, STEEL_DARK], [0.36, r, STEEL],
      [-0.18, r * 2 + 0.12, STEEL_DARK], [0.18, r * 2 + 0.12, STEEL],
      [0, r * 3 + 0.26, STEEL_DARK],
    ];
    return rows.map(([z, y, color]) => cylinder8([0, y, z], r, len, color, [0, 0, 90]));
  },
  corrugatedSheet: () => {
    const h = propKindDefinitionStrict('corrugatedSheet').heightMeters;
    const zinc = hx('#b8bcb6');
    const parts: PropPartSpec[] = [
      box([0, h * 0.49, 0], [1.9, h, 0.05], zinc, [14, 0, 0]),
      box([-0.35, h * 0.6, -0.045], [0.7, h * 0.3, 0.02], RUST, [14, 0, 0]),
    ];
    for (const x of [-0.6, 0, 0.6]) parts.push(box([x, h * 0.49, -0.04], [0.09, h * 0.96, 0.03], hx('#a0a49e'), [14, 0, 0]));
    return parts;
  },
  cableSpool: () => {
    const def = propKindDefinitionStrict('cableSpool');
    const r = def.footprintRadiusMeters;
    const h = def.heightMeters;
    return [
      cylinder16([0, 0.06, 0], r, 0.12, WOOD_PALE),
      cylinder16([0, h - 0.06, 0], r, 0.12, WOOD_PALE),
      cylinder16([0, h / 2, 0], r * 0.42, h - 0.24, WOOD_DARK),
      cylinder16([0, h / 2, 0], r * 0.62, h - 0.36, hx('#23262a')),
      cylinder8([0, h + 0.015, 0], 0.06, 0.05, METAL),
    ];
  },
  lockerSet: () => {
    const def = propKindDefinitionStrict('lockerSet');
    const h = def.heightMeters;
    const blue = hx('#2563a8');
    const blueDark = hx('#1b4a80');
    const parts: PropPartSpec[] = [
      box([0, 0.05, 0], [0.9, 0.1, 0.5], NEAR_BLACK),
      box([0, h / 2 + 0.04, 0], [0.9, h - 0.12, 0.5], blue),
    ];
    for (const x of [-0.15, 0.15]) parts.push(box([x, h / 2, -0.252], [0.015, h - 0.3, 0.015], blueDark));
    for (const x of [-0.3, 0, 0.3]) {
      parts.push(box([x, h - 0.35, -0.255], [0.18, 0.045, 0.012], blueDark)); // vent
      parts.push(box([x + 0.1, h * 0.55, -0.26], [0.025, 0.07, 0.02], STEEL)); // handle
    }
    return parts;
  },
  oilTank: () => {
    const def = propKindDefinitionStrict('oilTank');
    const r = def.heightMeters / 2 - 0.25;
    const len = def.footprintRadiusMeters * 2 - 0.4;
    const shell = hx('#a89684');
    return [
      cylinder16([0, r + 0.5, 0], r, len, shell, [0, 0, 90]),
      sphere([len / 2, r + 0.5, 0], [0.6, r * 1.9, r * 1.9], hx('#968471')),
      sphere([-len / 2, r + 0.5, 0], [0.6, r * 1.9, r * 1.9], hx('#968471')),
      cylinder8([0.4, r * 2 + 0.5, 0], 0.18, 0.24, RUST),
      box([-len * 0.32, 0.28, 0], [0.32, 0.56, r * 1.9], hx('#82827a')),
      box([len * 0.32, 0.28, 0], [0.32, 0.56, r * 1.9], hx('#82827a')),
    ];
  },
  tire: () => {
    const R = propKindDefinitionStrict('tire').heightMeters / 2;
    return [
      cylinder16([0, R, 0], R, R * 0.68, NEAR_BLACK, [90, 0, 0]),
      cylinder16([0, R, 0], R * 0.46, R * 0.72, hx('#6c727b'), [90, 0, 0]),
      cylinder8([0, R, 0], R * 0.14, R * 0.76, hx('#52565d'), [90, 0, 0]),
    ];
  },
  tireStack: () => {
    const parts: PropPartSpec[] = [];
    const jitter = [[0.04, -0.02], [-0.05, 0.03], [0.02, 0.05], [-0.03, -0.04]];
    for (let i = 0; i < 4; i += 1) {
      parts.push(cylinder16([jitter[i][0], 0.13 + i * 0.24, jitter[i][1]], 0.42, 0.23, i % 2 === 0 ? NEAR_BLACK : hx('#232628')));
    }
    parts.push(cylinder16([jitter[3][0], 1.0, jitter[3][1]], 0.2, 0.02, hx('#0c0d0e')));
    return parts;
  },
  barrel: () => {
    const h = propKindDefinitionStrict('barrel').heightMeters;
    return [
      cylinder16([0, h * 0.13, 0], 0.3, h * 0.26, WOOD),
      cylinder16([0, h * 0.5, 0], 0.35, h * 0.52, WOOD),
      cylinder16([0, h * 0.87, 0], 0.3, h * 0.26, WOOD),
      cylinder16([0, h * 0.28, 0], 0.355, h * 0.06, METAL),
      cylinder16([0, h * 0.72, 0], 0.355, h * 0.06, METAL),
      cylinder16([0, h - 0.01, 0], 0.27, 0.04, WOOD_DARK),
    ];
  },
  steelDrum: () => {
    const h = propKindDefinitionStrict('steelDrum').heightMeters;
    const body = hx('#7a3b2a');
    return [
      cylinder16([0, h * 0.48, 0], 0.3, h * 0.94, body),
      cylinder16([0, h * 0.33, 0], 0.315, h * 0.05, hx('#5e2c1e')),
      cylinder16([0, h * 0.66, 0], 0.315, h * 0.05, hx('#5e2c1e')),
      cylinder16([0, h * 0.97, 0], 0.295, h * 0.04, hx('#4a4843')),
    ];
  },
  propaneTank: () => {
    const h = propKindDefinitionStrict('propaneTank').heightMeters;
    return [
      cylinder16([0, h * 0.42, 0], 0.23, h * 0.56, WHITE),
      sphere([0, h * 0.7, 0], [0.46, h * 0.42, 0.46], WHITE),
      cylinder16([0, h * 0.07, 0], 0.2, h * 0.14, hx('#d2d4d6')),
      cylinder8([0, h * 0.88, 0], 0.12, h * 0.16, hx('#d2d4d6')),
      box([0, h * 0.97, 0], [0.1, h * 0.06, 0.04], hx('#c14d4d')),
    ];
  },
  jerryCan: () => {
    const h = propKindDefinitionStrict('jerryCan').heightMeters;
    const red = hx('#b03028');
    return [
      box([0, h * 0.46, 0], [0.36, h * 0.84, 0.17], red),
      box([0, h * 0.94, 0], [0.2, h * 0.08, 0.06], hx('#8e1d22')),
      cylinder8([0.13, h * 0.93, 0], 0.035, h * 0.14, hx('#8e1d22'), [0, 0, -20]),
    ];
  },
  cinderBlock: () => [
    box([0, 0.11, 0], [0.44, 0.22, 0.22], hx('#a8a8a0')),
    box([-0.1, 0.222, 0], [0.13, 0.015, 0.16], hx('#62625c')),
    box([0.1, 0.222, 0], [0.13, 0.015, 0.16], hx('#62625c')),
  ],
  brick: () => [box([0, 0.036, 0], [0.23, 0.07, 0.11], hx('#9c4a36'))],
  rubblePile: () => {
    const { heightMeters: h, footprintRadiusMeters: r } = propKindDefinitionStrict('rubblePile');
    return [
      box([0, h * 0.35, 0], [r * 1.1, h * 0.7, r * 0.9], STONE_DARK, [6, 20, -8]),
      box([r * 0.5, h * 0.2, -r * 0.3], [r * 0.7, h * 0.4, r * 0.6], CONCRETE, [-10, 55, 6]),
      box([-r * 0.45, h * 0.18, r * 0.35], [r * 0.6, h * 0.36, r * 0.55], STONE_LIGHT, [8, -40, -10]),
      box([r * 0.15, h * 0.62, r * 0.2], [r * 0.45, h * 0.3, r * 0.4], CONCRETE, [15, 70, 12]),
      box([-r * 0.2, h * 0.55, -r * 0.35], [r * 0.4, h * 0.28, r * 0.35], STONE, [-12, 30, 8]),
      box([r * 0.55, h * 0.1, r * 0.45], [0.23, 0.07, 0.11], hx('#9c4a36'), [0, 35, 0]),
      cylinder8([-r * 0.6, h * 0.12, -r * 0.2], 0.06, 0.5, STEEL_DARK, [0, 25, 80]),
    ];
  },
  toiletPaper: () => {
    const h = propKindDefinitionStrict('toiletPaper').heightMeters;
    return [
      box([0, h - 0.04, -0.05], [0.16, 0.04, 0.1], STEEL),
      cylinder8([0, h - 0.12, -0.12], 0.07, 0.13, WHITE, [0, 0, 90]),
      box([0, h - 0.21, -0.18], [0.1, 0.16, 0.012], hx('#e2e4e6')),
    ];
  },

  // ── PROPVENUE-0611 (req_0640): parks + shop interiors ────────────────────
  fountain: () => {
    const r = propKindDefinitionStrict('fountain').footprintRadiusMeters;
    const water = hx('#3a8fd8');
    const waterPale = hx('#bfe3f2');
    return [
      cylinder16([0, 0.275, 0], r, 0.55, CONCRETE),
      cylinder16([0, 0.29, 0], r * 0.88, 0.5, water),
      cylinder8([0, 0.95, 0], 0.25, 0.9, hx('#a8a59c')),
      cylinder16([0, 1.45, 0], 0.7, 0.16, CONCRETE),
      cylinder16([0, 1.5, 0], 0.6, 0.1, water),
      cylinder8([0, 1.85, 0], 0.07, 0.6, waterPale),
      sphere([0, 2.15, 0], [0.42, 0.24, 0.42], waterPale),
    ];
  },
  drinkingFountain: () => {
    const h = propKindDefinitionStrict('drinkingFountain').heightMeters;
    return [
      box([0, h * 0.46, 0], [0.28, h * 0.92, 0.28], STEEL_DARK),
      box([0, h * 0.94, -0.04], [0.4, h * 0.12, 0.38], STEEL),
      cylinder8([0.08, h + 0.025, -0.08], 0.022, 0.07, hx('#d2d4d6')),
    ];
  },
  loungeChair: () => {
    const len = propKindDefinitionStrict('loungeChair').footprintRadiusMeters * 2;
    const frame = hx('#e8e4da');
    const cushion = hx('#3a8fd8');
    return [
      box([-len * 0.1, 0.32, 0], [len * 0.74, 0.07, 0.58], cushion),
      box([len * 0.33, 0.5, 0], [len * 0.36, 0.07, 0.58], cushion, [0, 0, -38]),
      box([-len * 0.4, 0.18, -0.24], [0.06, 0.36, 0.05], frame),
      box([-len * 0.4, 0.18, 0.24], [0.06, 0.36, 0.05], frame),
      box([len * 0.18, 0.18, -0.24], [0.06, 0.36, 0.05], frame),
      box([len * 0.18, 0.18, 0.24], [0.06, 0.36, 0.05], frame),
      box([-len * 0.12, 0.27, 0], [len * 0.7, 0.04, 0.62], frame),
    ];
  },
  swingset: () => {
    const def = propKindDefinitionStrict('swingset');
    const h = def.heightMeters;
    const halfSpan = def.footprintRadiusMeters * 0.9;
    const frame = hx('#c1272d');
    const chain = hx('#9aa1ab');
    const rubber = hx('#1a1c1e');
    const parts: PropPartSpec[] = [
      cylinder8([0, h - 0.06, 0], 0.06, halfSpan * 2 + 0.3, frame, [0, 0, 90]),
    ];
    for (const sx of [-1, 1]) {
      parts.push(box([sx * halfSpan, h / 2 - 0.05, -0.55], [0.09, h, 0.09], frame, [20, 0, 0]));
      parts.push(box([sx * halfSpan, h / 2 - 0.05, 0.55], [0.09, h, 0.09], frame, [-20, 0, 0]));
    }
    for (const sx of [-0.65, 0.65]) {
      parts.push(box([sx - 0.2, h - 0.95, 0], [0.025, 1.7, 0.025], chain));
      parts.push(box([sx + 0.2, h - 0.95, 0], [0.025, 1.7, 0.025], chain));
      parts.push(box([sx, h - 1.85, 0], [0.5, 0.05, 0.22], rubber));
    }
    return parts;
  },
  sandCastle: () => {
    const sand = hx('#d8c08a');
    const sandDark = hx('#c0a870');
    const parts: PropPartSpec[] = [box([0, 0.15, 0], [0.45, 0.3, 0.45], sand)];
    for (const [x, z] of [[-0.22, -0.22], [0.22, -0.22], [-0.22, 0.22], [0.22, 0.22]] as const) {
      parts.push(cylinder8([x, 0.21, z], 0.09, 0.42, sand));
      parts.push(cylinder8([x, 0.45, z], 0.055, 0.07, sandDark));
    }
    parts.push(box([0, 0.34, 0], [0.3, 0.18, 0.3], sandDark));
    parts.push(box([0, 0.1, -0.235], [0.12, 0.2, 0.03], hx('#8a7548')));
    return parts;
  },
  picketFence: () => {
    const def = propKindDefinitionStrict('picketFence');
    const h = def.heightMeters;
    const halfSpan = def.footprintRadiusMeters * 0.95;
    const white = WHITE;
    const shade = hx('#d8dade');
    const parts: PropPartSpec[] = [
      box([0, h * 0.72, 0], [halfSpan * 2, 0.09, 0.04], shade),
      box([0, h * 0.28, 0], [halfSpan * 2, 0.09, 0.04], shade),
    ];
    const pickets = 7;
    for (let i = 0; i < pickets; i += 1) {
      const x = -halfSpan + (i / (pickets - 1)) * halfSpan * 2;
      parts.push(box([x, h * 0.48, -0.01], [0.1, h * 0.92, 0.025], white));
      parts.push(box([x, h * 0.97, -0.01], [0.07, h * 0.08, 0.025], white, [0, 0, 45]));
    }
    return parts;
  },
  appleTree: () => {
    const def = propKindDefinitionStrict('appleTree');
    const h = def.heightMeters;
    const r = def.footprintRadiusMeters;
    const c = h * 0.3;
    const bark = hx('#5c4631');
    const leafMid = hx('#2f6b2f');
    const leafLight = hx('#43883a');
    const appleRed = hx('#c1272d');
    const parts: PropPartSpec[] = [
      cylinder8([0, h * 0.26, 0], r, h * 0.52, bark),
      sphere([0, h * 0.68, 0], [c * 2.1, c * 1.7, c * 2.1], leafMid),
      sphere([c * 0.7, h * 0.6, c * 0.3], [c * 1.3, c * 1.1, c * 1.3], leafLight),
      sphere([-c * 0.65, h * 0.62, -c * 0.3], [c * 1.2, c, c * 1.2], leafMid),
      sphere([0, h * 0.84, 0], [c * 1.2, c * 0.9, c * 1.2], leafLight),
    ];
    // apples studding the canopy edge (the kickable 'apple' prop is its own kind)
    const spots: [number, number, number][] = [
      [c * 0.9, h * 0.62, c * 0.5], [-c * 0.85, h * 0.66, c * 0.4], [c * 0.3, h * 0.56, -c * 0.9],
      [-c * 0.4, h * 0.58, -c * 0.75], [c * 0.65, h * 0.78, -c * 0.3], [-c * 0.2, h * 0.82, c * 0.7],
    ];
    for (const [x, y, z] of spots) parts.push(sphere([x, y, z], [0.13, 0.13, 0.13], appleRed));
    return parts;
  },
  apple: () => [
    sphere([0, 0.05, 0], [0.1, 0.09, 0.1], hx('#c1272d')),
    box([0, 0.1, 0], [0.012, 0.03, 0.012], hx('#5c4631')),
  ],
  arcadeCabinet: () => {
    const s = propKindDefinitionStrict('arcadeCabinet').heightMeters / 2.0;
    const cab = hx('#3b2a5e');
    const trim = hx('#d83a6a');
    return [
      box([0, 0.09 * s, 0], [0.66 * s, 0.18 * s, 0.7 * s], NEAR_BLACK),
      box([0, 1.0 * s, 0.02 * s], [0.66 * s, 1.7 * s, 0.66 * s], cab),
      box([0, 1.9 * s, 0], [0.68 * s, 0.22 * s, 0.68 * s], trim),
      // the game's art — image target (the screen)
      panel('screen', [0, 1.38 * s, -0.345 * s], [0.56 * s, 0.5 * s, 0.03 * s], hx('#15314e'), [-6, 0, 0]),
      box([0, 1.0 * s, -0.4 * s], [0.6 * s, 0.09 * s, 0.32 * s], hx('#2a1e44'), [12, 0, 0]),
      cylinder8([-0.12 * s, 1.06 * s, -0.46 * s], 0.025 * s, 0.04 * s, hx('#c1272d'), [12, 0, 0]),
      cylinder8([0.1 * s, 1.06 * s, -0.46 * s], 0.025 * s, 0.04 * s, hx('#2e6fb0'), [12, 0, 0]),
    ];
  },
  slotMachine: () => {
    const s = propKindDefinitionStrict('slotMachine').heightMeters / 1.45;
    const body = hx('#c1272d');
    const gold = hx('#d8b23a');
    return [
      box([0, 0.25 * s, 0], [0.4 * s, 0.5 * s, 0.4 * s], NEAR_BLACK),
      box([0, 0.85 * s, 0], [0.55 * s, 0.7 * s, 0.5 * s], body),
      box([0, 0.95 * s, -0.26 * s], [0.4 * s, 0.22 * s, 0.02 * s], WHITE),
      box([-0.12 * s, 0.95 * s, -0.275 * s], [0.08 * s, 0.14 * s, 0.01 * s], hx('#c14d4d')),
      box([0, 0.95 * s, -0.275 * s], [0.08 * s, 0.14 * s, 0.01 * s], gold),
      box([0.12 * s, 0.95 * s, -0.275 * s], [0.08 * s, 0.14 * s, 0.01 * s], hx('#2e6f55')),
      box([0, 0.62 * s, -0.26 * s], [0.3 * s, 0.1 * s, 0.02 * s], NEAR_BLACK),
      cylinder8([0.32 * s, 1.0 * s, 0], 0.02 * s, 0.3 * s, STEEL),
      sphere([0.32 * s, 1.17 * s, 0], [0.08 * s, 0.08 * s, 0.08 * s], body),
      cylinder8([0, 1.32 * s, 0], 0.07 * s, 0.24 * s, gold),
    ];
  },
  clothingRack: () => {
    const def = propKindDefinitionStrict('clothingRack');
    const h = def.heightMeters;
    const halfSpan = def.footprintRadiusMeters * 0.9;
    const clothes: Color[] = [hx('#c14d4d'), hx('#2e6fb0'), hx('#56a85c'), hx('#d8a23a'), hx('#7a4a8a'), hx('#e0e0d4')];
    const parts: PropPartSpec[] = [
      cylinder8([-halfSpan, h / 2, 0], 0.03, h, STEEL),
      cylinder8([halfSpan, h / 2, 0], 0.03, h, STEEL),
      box([-halfSpan, 0.03, 0], [0.5, 0.05, 0.5], STEEL_DARK),
      box([halfSpan, 0.03, 0], [0.5, 0.05, 0.5], STEEL_DARK),
      cylinder8([0, h - 0.03, 0], 0.025, halfSpan * 2, STEEL, [0, 0, 90]),
    ];
    clothes.forEach((color, i) => {
      const x = -halfSpan * 0.78 + (i / (clothes.length - 1)) * halfSpan * 1.56;
      parts.push(box([x, h - 0.45, 0], [0.26, 0.74, 0.1], color));
    });
    return parts;
  },
  displayCase: () => {
    const def = propKindDefinitionStrict('displayCase');
    const w = def.footprintRadiusMeters * 2;
    const glass = hx('#cfe6f2');
    return [
      box([0, 0.27, 0], [w, 0.54, 0.7], WOOD_DARK),
      box([0, 0.76, 0], [w - 0.02, 0.42, 0.66], glass),
      box([0, 0.99, 0], [w, 0.04, 0.72], STEEL),
      box([-w * 0.25, 0.62, 0], [0.18, 0.12, 0.3], hx('#d8a23a')),
      box([w * 0.05, 0.61, 0.1], [0.14, 0.1, 0.2], hx('#7a4a8a')),
      box([w * 0.3, 0.62, -0.08], [0.16, 0.12, 0.24], hx('#56a85c')),
    ];
  },
  liquorShelf: () => {
    const def = propKindDefinitionStrict('liquorShelf');
    const h = def.heightMeters;
    const span = def.footprintRadiusMeters * 2;
    const bottle: Color[] = [hx('#b06f2a'), hx('#2e6f55'), hx('#cfe6f2'), hx('#7a3b2a')];
    const parts: PropPartSpec[] = [
      box([0, h / 2, 0.2], [span, h, 0.05], WOOD_DARK),
      box([0, 0.06, 0], [span, 0.12, 0.45], WOOD_DARK),
      box([-span / 2 + 0.03, h / 2, 0], [0.06, h, 0.42], WOOD),
      box([span / 2 - 0.03, h / 2, 0], [0.06, h, 0.42], WOOD),
    ];
    const shelfYs = [h * 0.35, h * 0.6, h * 0.85];
    shelfYs.forEach((y, row) => {
      parts.push(box([0, y, 0.02], [span - 0.12, 0.04, 0.38], WOOD));
      for (let i = 0; i < 5; i += 1) {
        const x = -span * 0.36 + (i / 4) * span * 0.72;
        parts.push(cylinder8([x, y + 0.17, 0.02], 0.045, 0.3, bottle[(row * 5 + i) % bottle.length]));
      }
    });
    return parts;
  },
  beerCase: () => [
    box([0, 0.14, 0], [0.5, 0.28, 0.34], hx('#b03028')),
    box([0, 0.41, 0.02], [0.48, 0.26, 0.33], hx('#d8b23a'), [0, 6, 0]),
    box([0, 0.28, -0.01], [0.46, 0.03, 0.3], NEAR_BLACK),
  ],
  dinerBooth: () => {
    const def = propKindDefinitionStrict('dinerBooth');
    const w = def.footprintRadiusMeters * 2;
    const vinyl = hx('#c14d4d');
    const vinylDark = hx('#a83a3a');
    return [
      box([0, 0.45, -0.5], [w - 0.1, 0.14, 0.45], vinyl),
      box([0, 0.7, -0.72], [w - 0.1, 0.85, 0.12], vinylDark),
      box([0, 0.45, 0.5], [w - 0.1, 0.14, 0.45], vinyl),
      box([0, 0.7, 0.72], [w - 0.1, 0.85, 0.12], vinylDark),
      box([0, 0.22, -0.5], [w - 0.14, 0.32, 0.4], NEAR_BLACK),
      box([0, 0.22, 0.5], [w - 0.14, 0.32, 0.4], NEAR_BLACK),
      box([0, 0.74, 0], [w - 0.3, 0.06, 0.6], WHITE),
      cylinder8([0, 0.37, 0], 0.06, 0.74, STEEL_DARK),
    ];
  },
  orderCounter: () => {
    const def = propKindDefinitionStrict('orderCounter');
    const w = def.footprintRadiusMeters * 2;
    const face = hx('#c14d4d');
    return [
      box([0, 0.5, 0], [w, 1.0, 0.7], face),
      box([0, 1.03, 0], [w + 0.06, 0.06, 0.78], WHITE),
      box([0, 0.5, -0.36], [w - 0.2, 0.5, 0.02], hx('#a83a3a')),
      box([w * 0.22, 1.18, 0.05], [0.3, 0.24, 0.3], NEAR_BLACK),
      box([-w * 0.2, 1.09, 0], [0.34, 0.05, 0.3], STEEL),
    ];
  },
  menuBoard: () => [
    box([0, 2.0, -0.03], [1.84, 0.94, 0.05], NEAR_BLACK),
    // the menu — image target
    panel('face', [0, 2.0, -0.06], [1.7, 0.8, 0.02], hx('#15314e')),
  ],
  sodaMachine: () => {
    const s = propKindDefinitionStrict('sodaMachine').heightMeters / 1.7;
    const body = hx('#c1272d');
    return [
      box([0, 0.8 * s, 0], [0.8 * s, 1.6 * s, 0.6 * s], body),
      // the brandable front — image target
      panel('front', [0, 1.15 * s, -0.305 * s], [0.7 * s, 0.7 * s, 0.02 * s], hx('#8e1d22')),
      box([-0.2 * s, 0.55 * s, -0.31 * s], [0.16 * s, 0.4 * s, 0.04 * s], NEAR_BLACK),
      box([0, 0.55 * s, -0.31 * s], [0.16 * s, 0.4 * s, 0.04 * s], NEAR_BLACK),
      box([0.2 * s, 0.55 * s, -0.31 * s], [0.16 * s, 0.4 * s, 0.04 * s], NEAR_BLACK),
      box([0, 0.3 * s, -0.28 * s], [0.6 * s, 0.05 * s, 0.12 * s], STEEL),
    ];
  },
  openSign: () => [
    box([0, 1.9, -0.025], [0.62, 0.34, 0.04], NEAR_BLACK),
    box([0, 1.9, -0.05], [0.5, 0.2, 0.015], hx('#ff4f6a')),
    box([0, 1.9, -0.055], [0.42, 0.12, 0.01], hx('#ffd9e0')),
  ],
  greenCrossSign: () => {
    const green = hx('#2ea84f');
    return [
      box([0, 2.3, -0.04], [0.95, 0.95, 0.08], WHITE),
      box([0, 2.3, -0.09], [0.24, 0.78, 0.025], green),
      box([0, 2.3, -0.09], [0.78, 0.24, 0.025], green),
    ];
  },
};

// propKindDefinition typed against the registry — a recipe asking for a kind
// that left the registry is a build error at the lookup site, not a silent
// undefined. (Thin alias kept local so recipes read tight.)
function propKindDefinitionStrict(kind: PropKind) {
  return propKindDefinition(kind);
}

/** The data recipe for a kind, or null when the kind has a bespoke model
 *  (the pre-batch props keep their hand-built cases in both renderers). */
export function propModelParts(kind: PropKind): PropPartSpec[] | null {
  const recipe = RECIPES[kind];
  return recipe ? recipe() : null;
}

/** Kinds whose model is data-driven (PROPBATCH) — the /test renderer maps
 *  these to the generic DataProp component. */
export function hasPropModelRecipe(kind: PropKind): boolean {
  return RECIPES[kind] !== undefined;
}

const FOOTPRINT_DEG = Math.PI / 180;

// A walking player only collides with what stands in its own height band — the
// canopy 5m up, the blade sign overhead, a high shelf's top are visual, not
// blockers. The band is the player capsule height (HMSC_SCALE, the one source),
// measured up from the prop's ground anchor; parts entirely above it don't widen
// the footprint into a phantom ground wall (PROPFOOT-0759: a derived appleTree
// was a 5m collision blob from its canopy until this gate).
const FOOTPRINT_BAND_METERS = HMSC_SCALE.playerCapsuleHeightMeters;

// One local point spun by a part's own Euler rotation (degrees), Rz·Ry·Rx — the
// SAME order the renderer composes before the prop's yaw. Used to find the true
// XZ extent (and Y, to test the band) of a tilted part (the A-frame's ±12°
// boards, a leaning blade).
function rotatePartPoint(x: number, y: number, z: number, rx: number, ry: number, rz: number): { x: number; y: number; z: number } {
  const cx = Math.cos(rx * FOOTPRINT_DEG), sx = Math.sin(rx * FOOTPRINT_DEG);
  const y1 = y * cx - z * sx, z1 = y * sx + z * cx;
  const cy = Math.cos(ry * FOOTPRINT_DEG), sy = Math.sin(ry * FOOTPRINT_DEG);
  const x2 = x * cy + z1 * sy, z2 = -x * sy + z1 * cy;
  const cz = Math.cos(rz * FOOTPRINT_DEG), sz = Math.sin(rz * FOOTPRINT_DEG);
  const x3 = x2 * cz - y1 * sz, y3 = x2 * sz + y1 * cz;
  return { x: x3, y: y3, z: z2 };
}

/** The EXACT measured footprint of a data-recipe prop. */
export type PropModelFootprint = {
  /** local-X span of the in-band model mass, meters */
  widthMeters: number;
  /** local-Z span, meters */
  depthMeters: number;
  /** the model's XZ center in its OWN (un-yawed) local frame — nonzero when the
   *  mass is authored off the placement anchor. Consumers rotate this by the
   *  prop's yaw so the footprint tracks the mesh at any rotation (FOOTPRINT-0765). */
  offsetXMeters: number;
  offsetZMeters: number;
  /** the model reads ROUND in plan (cylinder/sphere mass dominates and width ≈
   *  depth) — collision should be a CIRCLE of radius max(width,depth)/2, not a
   *  square that overhangs the corners (a fountain, barrel, drum). */
  round: boolean;
};

/** FOOTPRINT-0759/0765: the EXACT collision footprint of a data-recipe prop,
 *  measured from the model itself — the XZ bounding box over the parts that stand
 *  in the player's walking band (see FOOTPRINT_BAND_METERS), so the player bumps
 *  precisely what they see at body height, with no hand-tuned number to drift.
 *  Carries the model's center OFFSET (so an off-center body tracks under rotation)
 *  and a ROUND flag (so a circular base collides as a circle, not a square).
 *  Returns null for bespoke (TSX) models — they keep a measured footprint field —
 *  and for props whose mass is ALL overhead (a hanging blade sign), so those fall
 *  back to the kind's footprintRadius square. A cylinder's size is [diameter, h,
 *  diameter], so its corner box IS its circular footprint's AABB. */
export function propModelFootprintMeters(kind: PropKind): PropModelFootprint | null {
  const parts = propModelParts(kind);
  if (!parts || parts.length === 0) return null;
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  let roundVolume = 0, boxVolume = 0;
  let inBand = false;
  for (const part of parts) {
    const hx = part.size[0] / 2, hy = part.size[1] / 2, hz = part.size[2] / 2;
    const rx = part.rotation?.[0] ?? 0, ry = part.rotation?.[1] ?? 0, rz = part.rotation?.[2] ?? 0;
    let partMinY = Infinity, partMaxY = -Infinity;
    let pMinX = Infinity, pMaxX = -Infinity, pMinZ = Infinity, pMaxZ = -Infinity;
    for (const ax of [-1, 1] as const) {
      for (const ay of [-1, 1] as const) {
        for (const az of [-1, 1] as const) {
          const r = rotatePartPoint(ax * hx, ay * hy, az * hz, rx, ry, rz);
          const py = part.local[1] + r.y;
          if (py < partMinY) partMinY = py;
          if (py > partMaxY) partMaxY = py;
          const wx = part.local[0] + r.x;
          const wz = part.local[2] + r.z;
          if (wx < pMinX) pMinX = wx;
          if (wx > pMaxX) pMaxX = wx;
          if (wz < pMinZ) pMinZ = wz;
          if (wz > pMaxZ) pMaxZ = wz;
        }
      }
    }
    // Skip parts that float entirely above the player (canopy, hanging sign) or
    // below the ground anchor — they are not what a walking body runs into.
    if (partMaxY < 0 || partMinY > FOOTPRINT_BAND_METERS) continue;
    inBand = true;
    if (pMinX < minX) minX = pMinX;
    if (pMaxX > maxX) maxX = pMaxX;
    if (pMinZ < minZ) minZ = pMinZ;
    if (pMaxZ > maxZ) maxZ = pMaxZ;
    const volume = part.size[0] * part.size[1] * part.size[2];
    if (part.shape === 'box') boxVolume += volume; else roundVolume += volume;
  }
  if (!inBand) return null;
  const widthMeters = maxX - minX;
  const depthMeters = maxZ - minZ;
  // Round only when the plan is near-square (a tall cylinder), so a long oval
  // cylinder (a pipe on its side) stays a rect, not a misfit circle.
  const round = roundVolume > boxVolume
    && Math.abs(widthMeters - depthMeters) < 0.15 * Math.max(widthMeters, depthMeters);
  return {
    widthMeters,
    depthMeters,
    offsetXMeters: (minX + maxX) / 2,
    offsetZMeters: (minZ + maxZ) / 2,
    round,
  };
}
