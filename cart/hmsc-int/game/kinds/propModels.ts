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
  /** < 1 = a TRANSLUCENT part (glass): the /test renderer draws it with this
   *  opacity, the bake interns a translucent flat material with the same alpha —
   *  the SAME path build-piece glass panes ride. Absent = opaque. */
  opacity?: number;
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
export function panel(partId: string, local: readonly [number, number, number], size: readonly [number, number, number], color: Color, rotation?: Rotation): PropPartSpec {
  return { shape: 'box', local, size, color, rotation, partId };
}

// The SAME glass build-piece windows wear (render3d/materials Glass / the window
// pane) — a cool architectural tint at window opacity. A glass box is translucent
// by default; it stays textureable, so a skin still overrides it. Kept as local
// constants (game/kinds must not import the render layer); mirrors materials.ts.
const GLASS_TINT = hx('#bcd3dd');
const GLASS_OPACITY = 0.3;
export function glassBox(local: readonly [number, number, number], size: readonly [number, number, number], rotation?: Rotation): PropPartSpec {
  return { shape: 'box', local, size, color: GLASS_TINT, rotation, opacity: GLASS_OPACITY };
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

// ── the shared palette (the kit's colours — props import these) ───────────────
export const STONE = hx('#6b7079');
export const STONE_DARK = hx('#52565d');
export const STONE_LIGHT = hx('#82868d');
export const METAL = hx('#3a3f46');
export const STEEL = hx('#9aa1ab');
export const STEEL_DARK = hx('#6c727b');
export const RUST = hx('#8a4a32');
export const WOOD = hx('#8a6240');
export const WOOD_DARK = hx('#6b4a2e');
export const WOOD_PALE = hx('#c2a878');
export const CONCRETE = hx('#b9b6ae');
export const NEAR_BLACK = hx('#1a1c1e');
export const WHITE = hx('#eef0f2');
export const GRASS_MID = hx('#3f7d33');
export const GRASS_LIGHT = hx('#5a9a42');
export const GRASS_DRY = hx('#8a9a4a');

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

// ── chairs (PROPSKIN-0769): migrated out of the bespoke render3d/props/Furniture
// component into a data recipe so every chair exposes skinnable PARTS (legs, seat,
// backrest) AND bakes faithfully — the bespoke model had no recipe, so a compiled
// chair fell back to a single box. Four legs + seat + a tilted backrest, the exact
// geometry the Furniture <Chair> drew. Painted variants pass body/leg colours.
const CHAIR_METAL = hx('#3a3f46');
function chairParts(body: Color, legColor: Color): PropPartSpec[] {
  const seatY = 0.45;
  const legSpots: [number, number, number][] = [[0.2, seatY / 2, 0.2], [-0.2, seatY / 2, 0.2], [0.2, seatY / 2, -0.2], [-0.2, seatY / 2, -0.2]];
  return [
    ...legSpots.map((p) => box(p, [0.05, seatY, 0.05], legColor)),
    box([0, seatY, 0], [0.5, 0.06, 0.5], body),                          // seat
    box([0, seatY + 0.27, 0.23], [0.5, 0.5, 0.05], body, [-6, 0, 0]),    // backrest (rises behind +Z, tilted)
  ];
}

// ── recipes for every PROPBATCH kind ─────────────────────────────────────────
// Keyed by kind; a kind absent here uses worldGeometry's bespoke case (the
// pre-batch props) or the registry-box placeholder.
const RECIPES: Partial<Record<PropKind, () => PropPartSpec[]>> = {
  chair: () => chairParts(WOOD, WOOD_DARK),
  chairRed: () => chairParts(hx('#b03a2e'), CHAIR_METAL),
  chairBlue: () => chairParts(hx('#2e6fb0'), CHAIR_METAL),
  chairGreen: () => chairParts(hx('#3a8f4f'), CHAIR_METAL),
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
    return [
      box([0, 0.27, 0], [w, 0.54, 0.7], WOOD_DARK),
      glassBox([0, 0.76, 0], [w - 0.02, 0.42, 0.66]),   // the real translucent glass pane (same as windows)
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
