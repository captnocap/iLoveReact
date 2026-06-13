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

  // ── PROPVENUE-0611 (req_0640): parks + shop interiors ────────────────────
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
