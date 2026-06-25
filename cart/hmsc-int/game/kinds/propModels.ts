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

// A neutral tan stand-in when a part spec arrives with no color (a recipe that
// omitted it, or a palette entry that was undefined at module-init time — see the
// COLORS import-cycle note in propRecipes/resolve.ts). Matches propColor's default.
const CSS_COLOR_FALLBACK: Color = [0.7, 0.6, 0.4];

// Robust against a missing/malformed color: a single prop part with no color must
// never throw and take down the WHOLE editor (req_1936 — `color[0]` on undefined
// crashed every thumbnail in the prop browser). dataPropParts logs WHICH kind is
// missing one so the real recipe gets fixed; here we just keep rendering.
export function cssColor(color: Color | undefined | null): string {
  const c = Array.isArray(color) && color.length >= 3 ? color : CSS_COLOR_FALLBACK;
  const channel = (v: number) => Math.max(0, Math.min(255, Math.round((Number(v) || 0) * 255))).toString(16).padStart(2, '0');
  return `#${channel(c[0])}${channel(c[1])}${channel(c[2])}`;
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
