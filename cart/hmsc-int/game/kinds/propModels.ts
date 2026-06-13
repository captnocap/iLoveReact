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
