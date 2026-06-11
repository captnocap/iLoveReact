// worldGeometry.ts — extrude the AUTHORED hmsc world into a flat 3D instance
// buffer the stateless loader renders with ZERO V8.
//
// This is the first capability through the universal pipe (PLATMOD): the React-
// authored world's geometry, lowered to encoded data. Two sources, both real:
//   • the GameState world layers (surface regions, roads, junctions, props,
//     landforms) — the painted ground the editor's preview shows; and
//   • the BUILD WORLD STREAM's PLACED PIECES (world.state().pieces) — the
//     walls/floors/pillars the /test play view renders as the city's structures.
//     A "Building 1" prefab is N placed pieces; a tower is stacked wall/pillar
//     pieces. These are the towers the user sees in /test — the loader MUST show
//     parity. Skinned walls and plates become the SAME core + face-slab boxes
//     that the play view's pieceVisualShapes emits, so per-face authored skins do
//     not collapse to a single front face in the no-V8 loader.
//
// Most objects become one instance: a (position, rotation, scale, color) row in
// a packed Float32Array. Stairs decompose into the same stepped boxes /test uses;
// ramps use the shared ramp slab mesh.
//
// Layout per instance (stride 13, first 12 match gpu/3d.zig makeInstance):
//   [ px, py, pz,  rx, ry, rz,  sx, sy, sz,  r, g, b,  shapeId ]
// position is the box CENTER (world meters, y up); rotation is degrees about
// each axis (only ry / yaw is used); scale is the full box size. shapeId 0 is
// the shared box; shapeId 1 is the shared ramp slab mesh.

import type { GameState, PropKind, BuildingKind, TileKind, WorldProp } from '../design';
import { propKindDefinition } from '../world/propKinds';
import { solveRoadCrossSection } from '../world/roadProfile';
import { tileKindDefinition } from '../world/tileKinds';
import { CHUNK_TILES } from '../chunks';
import { heightfieldTexelColor, roadRibbonSection } from '../render3d/heightfieldSurface';
import type { ChunkFloor } from '../chunkFloor';
import { GAME_BUILD } from '@game';
import type { BuildFaceSkin, BuildMaterial, PlacedBuildPiece } from '@game';
import { shaderSpec, defaultShaderData } from '@game/textures/shaders';
import { loadCustomTextures, type CustomTexture } from '@game/textures/materials';
import { BUILTIN_DECALS } from '@game/textures/builtinDecals';
import { packDecalDoc } from './decalPack';
import type { DecalAssetSink } from './decalAssets';
import { textBytes } from '@reactjit/workspace';

export const INSTANCE_STRIDE = 13;
export const INSTANCE_SHAPE_BOX = 0;
export const INSTANCE_SHAPE_RAMP = 1;
export const INSTANCE_SHAPE_CYLINDER8 = 2;
export const INSTANCE_SHAPE_CYLINDER16 = 3;
export const INSTANCE_SHAPE_SPHERE = 4;

// ── materials: ship the SHADER (the formula) — pixels only when there IS no formula ─
// GUIDING_LIGHT: procedural content travels as its recipe. A face whose skin is
// a {kind:'material'} carries a WGSL shader + its data[] params; we intern each
// DISTINCT (shader, data) once (content-addressed by its key) into a vocab the
// host materializes at load (run the shader → a 1-tile texture → sample the
// face). The geometry stream stays flat color; a PARALLEL per-row material index
// (0 = none) references the vocab, so the instance stride and all physics/spawn
// code are untouched. Both built-in shader-catalog ids AND 'custom:' Materialized
// SHADER looks resolve in the headless bake (the custom store is plain localstore;
// loadCustomTextures is React-free).
// DECAL customs ship the same way (DECALRECIPE-0610, GUIDING_LIGHT "store the
// recipe, not the product"): a decal's recipe is its DecalDoc — a declarative
// ~1KB document of rects/text/image refs — packed flat by ./decalPack and
// rasterized ONCE at load by the host's fixed systems (rounded-rect fills,
// FreeType glyphs — framework/gpu/decal_raster.zig), exactly as shaders are
// materialized. Pure data → data: no editor bake, no pixel cache, headless
// green always.
// A material the host materializes at load. `wgsl` is the shader recipe (empty
// for a TRANSLUCENT FLAT material like glass — no shader, just a tint + alpha the
// loader renders through the transparent pass). `opacity` < 1 marks translucency.
// `doc` (decals) is the packed DecalDoc recipe the loader rasterizes.
export type MaterialAsset = {
  key: string;
  wgsl: string;
  data: number[];
  opacity: number;
  doc?: Uint8Array;
};

// Translucent base materials — their look is an ALPHA, not a texture (glass/
// chainlink are see-through, not procedural). Mirrors pieceMeshes MATERIAL_LOOK
// opacity. A face on one of these (with no shader skin) ships a flat translucent
// material so the loader renders it see-through instead of as an opaque box.
const MATERIAL_ALPHA: Partial<Record<BuildMaterial, number>> = { glass: 0.3, chainlink: 0.45 };

// A material id → its shader recipe (WGSL + frozen data). Built-in catalog ids
// resolve via shaderSpec; 'custom:' ids resolve through the studio's saved
// materials (a base shaderId + a frozen data snapshot). Cached: loadCustom
// Textures reads the store once.
let customByIdCache: Map<string, CustomTexture> | null = null;
function customById(id: string): CustomTexture | undefined {
  if (!customByIdCache) customByIdCache = new Map(loadCustomTextures().map((t) => [t.id, t]));
  return customByIdCache.get(id);
}
/** Test seam: the custom-texture table caches for the process (the bake is
 *  one-shot); sequential tests re-stub the localstore, so let them drop it. */
export function resetCustomTextureCache(): void {
  customByIdCache = null;
}
function resolveMaterialShader(id: string): { wgsl: string; data: number[] } | null {
  const builtin = shaderSpec(id);
  if (builtin) return { wgsl: builtin.shader, data: defaultShaderData(builtin) };
  const custom = customById(id);
  if (custom?.shaderId !== undefined && custom.data !== undefined) {
    const spec = shaderSpec(custom.shaderId);
    if (spec) return { wgsl: spec.shader, data: custom.data }; // frozen tuned data
  }
  return null; // decal/react custom — no WGSL to ship (decals resolve as pixels below)
}

// A DECAL's packed recipe (DECALRECIPE-0610): the validated DecalDoc lowered
// to the flat binary the loader rasterizes (./decalPack). Custom records win
// (the /compose-authored library); BUILT-IN docs (FACADEDECAL-0610 — the
// transcribed React facades, e.g. internetCafe) resolve next, so facade-
// skinned faces compile instead of dropping flat. Null when the id is
// neither. No editor dependency, no staleness — the doc IS the source.
function resolveMaterialDoc(id: string, assets: DecalAssetSink | undefined): Uint8Array | null {
  const custom = customById(id);
  if (custom?.decal) return packDecalDoc(custom.decal, id, assets);
  const builtin = BUILTIN_DECALS[id];
  if (builtin) return packDecalDoc(builtin, id, assets);
  return null;
}

// One geometry-build accumulator: the packed instance rows PLUS a parallel
// material index per row (interned vocab). They grow in lockstep — every push
// appends exactly one row and one material ref.
type Build = {
  inst: number[];
  mats: number[];
  vocab: MaterialAsset[];
  index: Map<string, number>; // material key → 1-based vocab slot (0 = none)
  /** the bake's content-addressed image collector (DECALIMG-0610) — absent on
   *  paths that can't ship assets (decal image nodes then pack key 0) */
  assets?: DecalAssetSink;
};

function newBuild(assets?: DecalAssetSink): Build {
  return { inst: [], mats: [], vocab: [], index: new Map(), assets };
}

// Resolve a {kind:'material'} skin to its shipped recipe and intern it; return
// the 1-based vocab slot, or 0 when it can't travel (color skins, or a
// react-facade material the headless bake can't resolve — those keep their
// flat color). Shader recipes win; a decal ships its packed DecalDoc
// (DECALRECIPE-0610) for the loader to rasterize at load.
function internMaterial(b: Build, skin: BuildFaceSkin | undefined): number {
  if (!skin || skin.kind !== 'material') return 0;
  const resolved = resolveMaterialShader(skin.id);
  if (resolved) {
    const key = `${skin.id}|${resolved.data.join(',')}`;
    const existing = b.index.get(key);
    if (existing !== undefined) return existing;
    const slot = b.vocab.length + 1;
    b.vocab.push({ key, wgsl: resolved.wgsl, data: resolved.data, opacity: 1 });
    b.index.set(key, slot);
    return slot;
  }
  // Intern-check BEFORE packing — the doc key is the id alone, so the pack
  // (and its follow-up warnings) runs once per decal, not once per face.
  const key = `doc:${skin.id}`;
  const existing = b.index.get(key);
  if (existing !== undefined) return existing;
  const doc = resolveMaterialDoc(skin.id, b.assets);
  if (!doc) return 0; // react-facade material — keeps the flat color
  const slot = b.vocab.length + 1;
  b.vocab.push({ key, wgsl: '', data: [], opacity: 1, doc });
  b.index.set(key, slot);
  return slot;
}

// Intern a TRANSLUCENT FLAT material for a base BuildMaterial (glass/chainlink) —
// no shader, just an alpha; the row keeps its own MATERIAL_COLOR tint. Returns 0
// for opaque materials (they stay in the flat instanced batch).
function internTranslucent(b: Build, material: BuildMaterial): number {
  const opacity = MATERIAL_ALPHA[material];
  if (opacity === undefined) return 0;
  const key = `flat:${material}`;
  const existing = b.index.get(key);
  if (existing !== undefined) return existing;
  const slot = b.vocab.length + 1;
  b.vocab.push({ key, wgsl: '', data: [], opacity });
  b.index.set(key, slot);
  return slot;
}

// The material slot a face wears: a shader skin wins (textured), else the base
// material's translucency (glass → see-through), else 0 (opaque flat color).
function faceMaterial(b: Build, skin: BuildFaceSkin | undefined, baseMaterial: BuildMaterial): number {
  return internMaterial(b, skin) || internTranslucent(b, baseMaterial);
}
const HEIGHTFIELD_LUMP_VERSION = 2;
const HEIGHTFIELD_RECORD_FLOATS = 10;
const HEIGHTFIELD_TEXTURE_PIXELS_PER_TILE = 4;
const HEIGHTFIELD_TEXTURE_MAX_PX = 512;
const STAIR_VISUAL_STEPS = 4; // Matches BUILD_UI.stairVisualSteps in /test.
const BUILD_FACE_SLAB_THICKNESS_METERS = 0.02; // Matches BUILD_UI.faceSlabThicknessMeters.
const BUILD_FACE_SLAB_LIFT_METERS = 0.012; // Matches BUILD_UI.faceSlabLiftMeters.
const DEG = Math.PI / 180;

type Color = readonly [number, number, number];
type Rotation = readonly [number, number, number];

function pushShape(
  b: Build,
  shapeId: number,
  cx: number,
  cy: number,
  cz: number,
  rotation: Rotation,
  sx: number,
  sy: number,
  sz: number,
  color: Color,
  material = 0,
): void {
  b.inst.push(cx, cy, cz, rotation[0], rotation[1], rotation[2], sx, sy, sz, color[0], color[1], color[2], shapeId);
  b.mats.push(material);
}

function pushBox(
  b: Build,
  cx: number,
  cy: number,
  cz: number,
  sx: number,
  sy: number,
  sz: number,
  color: Color,
  yawDegrees = 0,
  material = 0,
): void {
  pushShape(b, INSTANCE_SHAPE_BOX, cx, cy, cz, [0, yawDegrees, 0], sx, sy, sz, color, material);
}

function pushRamp(
  b: Build,
  x: number,
  y: number,
  z: number,
  width: number,
  height: number,
  depth: number,
  color: Color,
  yawDegrees = 0,
  material = 0,
): void {
  pushShape(b, INSTANCE_SHAPE_RAMP, x, y + height / 2, z, [0, yawDegrees, 0], width, height, depth, color, material);
}

function localOffset(u: number, v: number, yawDegrees: number): { dx: number; dz: number } {
  const cos = Math.cos(yawDegrees * DEG);
  const sin = Math.sin(yawDegrees * DEG);
  return { dx: u * cos + v * sin, dz: -u * sin + v * cos };
}

function pushStairs(
  b: Build,
  x: number,
  y: number,
  z: number,
  width: number,
  height: number,
  depth: number,
  color: Color,
  yawDegrees = 0,
  material = 0,
): number {
  for (let i = 0; i < STAIR_VISUAL_STEPS; i += 1) {
    const v = (-depth / 2) + ((i + 0.5) / STAIR_VISUAL_STEPS) * depth;
    const stepHeight = ((i + 1) / STAIR_VISUAL_STEPS) * height;
    const { dx, dz } = localOffset(0, v, yawDegrees);
    pushBox(b, x + dx, y + stepHeight / 2, z + dz, width, stepHeight, depth / STAIR_VISUAL_STEPS, color, yawDegrees, material);
  }
  return STAIR_VISUAL_STEPS;
}

function hexColor(hex: string): Color {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16);
  return [((n >> 16) & 0xff) / 255, ((n >> 8) & 0xff) / 255, (n & 0xff) / 255];
}

function skinColor(skin: BuildFaceSkin | undefined, fallback: Color): Color {
  if (!skin) return fallback;
  if (skin.kind === 'color') return hexColor(skin.value);
  // The current instance lump carries color but not texture assets. Keep
  // material-skinned face slabs present and visibly assigned; the texture stream
  // can replace this fallback when skins RLE lands.
  return fallback;
}

// ── colors ────────────────────────────────────────────────────────────────

// Floor/tile color from the SAME source /test renders with: the tile kind's
// authored render.color (cart/hmsc/world/tileKinds). /test's FloorMesh paints a
// captured texture over white; the kind color is that texture's base — e.g.
// asphalt #20242d (near-black), the user's "black floor". Using a made-up palette
// here is what turned the floor white. No texture in the instanced path yet, so
// the flat kind color is the closest faithful match.
function tileColor(kind: TileKind | string): Color {
  try {
    return hexColor(tileKindDefinition(kind as TileKind).render.color);
  } catch {
    return [0.2, 0.22, 0.26];
  }
}

const PROP_BOX: Record<string, readonly [number, number, number]> = {
  // [width, height, depth] in meters
  bush: [1.2, 0.8, 1.2],
  bushLarge: [1.8, 1.1, 1.8],
  bushLow: [1.2, 0.5, 1.2],
  bushSparse: [1.0, 0.6, 1.0],
  rock: [1.0, 0.8, 1.0],
  rockLarge: [2.0, 1.6, 2.0],
  rockSmall: [0.6, 0.5, 0.6],
  fireHydrant: [0.4, 0.9, 0.4],
  streetSign: [0.3, 3.0, 0.3],
  streetLight: [0.3, 5.0, 0.3],
  stopSign: [0.3, 2.6, 0.3],
  trafficLight: [0.4, 5.0, 0.4],
  payphone: [0.6, 1.4, 0.4],
  dumpster: [1.6, 1.3, 1.0],
  mailbox: [0.5, 1.1, 0.5],
  fence: [1.0, 1.2, 0.2],
};

function propColor(kind: PropKind | string): Color {
  switch (kind) {
    case 'bush':
    case 'bushLarge':
    case 'bushLow':
    case 'bushSparse':
      return [0.3, 0.55, 0.25];
    case 'fireHydrant':
    case 'stopSign':
      return [0.82, 0.22, 0.16];
    case 'trafficLight':
      return [0.85, 0.7, 0.2];
    case 'streetLight':
    case 'streetSign':
    case 'payphone':
    case 'mailbox':
      return [0.5, 0.5, 0.55];
    case 'dumpster':
      return [0.25, 0.45, 0.3];
    case 'rock':
    case 'rockLarge':
    case 'rockSmall':
      return [0.5, 0.5, 0.52];
    case 'fence':
      return [0.55, 0.4, 0.25];
    default:
      return [0.7, 0.6, 0.4];
  }
}

type PropPartShape = 'box' | 'cylinder8' | 'cylinder16' | 'sphere';
type PropPartSpec = {
  shape: PropPartShape;
  local: readonly [number, number, number];
  size: readonly [number, number, number];
  color: Color;
  rotation?: Rotation;
};

function propAt(prop: WorldProp, local: readonly [number, number, number]): readonly [number, number, number] {
  const yaw = (prop.yawDegrees ?? 0) * DEG;
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  return [
    prop.x + local[0] * c + local[2] * s,
    (prop.y ?? 0) + local[1],
    prop.z - local[0] * s + local[2] * c,
  ];
}

function propShapeId(shape: PropPartShape): number {
  switch (shape) {
    case 'cylinder8': return INSTANCE_SHAPE_CYLINDER8;
    case 'cylinder16': return INSTANCE_SHAPE_CYLINDER16;
    case 'sphere': return INSTANCE_SHAPE_SPHERE;
    case 'box':
    default: return INSTANCE_SHAPE_BOX;
  }
}

function propRotation(prop: WorldProp, local: Rotation | undefined): Rotation {
  return [local?.[0] ?? 0, (prop.yawDegrees ?? 0) + (local?.[1] ?? 0), local?.[2] ?? 0];
}

function pushPropPart(b: Build, prop: WorldProp, part: PropPartSpec): void {
  const p = propAt(prop, part.local);
  pushShape(b, propShapeId(part.shape), p[0], p[1], p[2], propRotation(prop, part.rotation), part.size[0], part.size[1], part.size[2], part.color);
}

function pushPropParts(b: Build, prop: WorldProp, parts: readonly PropPartSpec[]): number {
  for (const part of parts) pushPropPart(b, prop, part);
  return parts.length;
}

function box(local: readonly [number, number, number], size: readonly [number, number, number], color: Color, rotation?: Rotation): PropPartSpec {
  return { shape: 'box', local, size, color, rotation };
}

function cylinder8(local: readonly [number, number, number], radius: number, height: number, color: Color, rotation?: Rotation): PropPartSpec {
  return { shape: 'cylinder8', local, size: [radius * 2, height, radius * 2], color, rotation };
}

function cylinder16(local: readonly [number, number, number], radius: number, height: number, color: Color, rotation?: Rotation): PropPartSpec {
  return { shape: 'cylinder16', local, size: [radius * 2, height, radius * 2], color, rotation };
}

function sphere(local: readonly [number, number, number], size: readonly [number, number, number], color: Color): PropPartSpec {
  return { shape: 'sphere', local, size, color };
}

function bushParts(prop: WorldProp): PropPartSpec[] {
  const def = propKindDefinition(prop.kind);
  const radius = def.footprintRadiusMeters;
  const height = def.heightMeters;
  const palette: Color[] = [[0x1f / 255, 0x4a / 255, 0x20 / 255], [0x2f / 255, 0x6b / 255, 0x2f / 255], [0x43 / 255, 0x88 / 255, 0x3a / 255]];
  const blobs = [
    { cx: 0, cy: 0.18, cz: 0, rh: 0.86, rv: 0.82, tint: 1 },
    { cx: 0.4, cy: 0.1, cz: 0.04, rh: 0.62, rv: 0.52, tint: 0 },
    { cx: -0.38, cy: 0.12, cz: 0.12, rh: 0.64, rv: 0.52, tint: 2 },
    { cx: 0.08, cy: 0.08, cz: -0.42, rh: 0.6, rv: 0.5, tint: 2 },
    { cx: -0.14, cy: 0.1, cz: 0.4, rh: 0.62, rv: 0.5, tint: 0 },
    { cx: 0.12, cy: 0.62, cz: 0.08, rh: 0.4, rv: 0.36, tint: 2 },
    { cx: -0.16, cy: 0.66, cz: -0.06, rh: 0.36, rv: 0.34, tint: 0 },
  ];
  for (let i = 0; i < 9; i += 1) {
    const a = (i / 9) * Math.PI * 2;
    const rh = 0.6 + (i % 3) * 0.05;
    blobs.push({ cx: Math.cos(a) * (rh - 0.04), cz: Math.sin(a) * (rh - 0.04), cy: 0.26 + (i % 2) * 0.14, rh, rv: 0.46, tint: i % 3 });
  }
  for (let i = 0; i < 6; i += 1) {
    const a = (i / 6) * Math.PI * 2 + 0.4;
    const rh = 0.42 + (i % 2) * 0.05;
    blobs.push({ cx: Math.cos(a) * (rh - 0.06), cz: Math.sin(a) * (rh - 0.06), cy: 0.5 + (i % 2) * 0.1, rh, rv: 0.4, tint: (i % 2) === 0 ? 2 : 0 });
  }
  return blobs.map((blob) => sphere([blob.cx * radius, blob.cy * height, blob.cz * radius], [blob.rh * radius * 2, blob.rv * height * 2, blob.rh * radius * 2], palette[blob.tint]));
}

function propParts(prop: WorldProp): PropPartSpec[] {
  const def = propKindDefinition(prop.kind);
  switch (prop.kind) {
    case 'bush':
    case 'bushLarge':
    case 'bushLow':
    case 'bushSparse':
      return bushParts(prop);
    case 'rock':
    case 'rockLarge':
    case 'rockSmall':
      return [
        sphere([0, def.heightMeters * 0.45, 0], [def.footprintRadiusMeters * 1.8, def.heightMeters * 0.9, def.footprintRadiusMeters * 1.55], [0.45, 0.46, 0.48]),
        sphere([def.footprintRadiusMeters * 0.25, def.heightMeters * 0.58, -def.footprintRadiusMeters * 0.1], [def.footprintRadiusMeters, def.heightMeters * 0.7, def.footprintRadiusMeters * 0.85], [0.56, 0.56, 0.58]),
      ];
    case 'dumpster': {
      const s = def.heightMeters / 1.2;
      const w = def.footprintRadiusMeters * 1.6 * s;
      const d = def.footprintRadiusMeters * 0.9 * s;
      return [
        box([0, 0.03 * s, 0], [w * 0.85, 0.06 * s, d * 0.8], [0x3a / 255, 0x4a / 255, 0x30 / 255]),
        box([0, 0.45 * s, 0], [w, 0.78 * s, d], [0x4a / 255, 0x5d / 255, 0x3f / 255]),
        box([0, 0.87 * s, 0], [w + 0.04 * s, 0.06 * s, d + 0.04 * s], [0x3a / 255, 0x4a / 255, 0x30 / 255]),
        box([0, 0.96 * s, d * 0.22], [w + 0.02 * s, 0.08 * s, d * 0.55], [0x55 / 255, 0x66 / 255, 0x49 / 255], [18, 0, 0]),
        box([0, 0.96 * s, -d * 0.22], [w + 0.02 * s, 0.08 * s, d * 0.55], [0x45 / 255, 0x55 / 255, 0x3a / 255], [-18, 0, 0]),
        box([0, 0.62 * s, 0], [w + 0.02 * s, 0.04 * s, d + 0.02 * s], [0x3a / 255, 0x4a / 255, 0x30 / 255]),
        box([0, 0.32 * s, 0], [w + 0.02 * s, 0.04 * s, d + 0.02 * s], [0x3a / 255, 0x4a / 255, 0x30 / 255]),
        box([w * 0.46, 0.5 * s, d * 0.46], [0.06 * s, 0.5 * s, 0.06 * s], [0x7a / 255, 0x5c / 255, 0x3a / 255]),
      ];
    }
    case 'streetSign': return [
      cylinder8([0, 0.06, 0], 0.14, 0.12, [0.42, 0.45, 0.48]),
      cylinder8([0, def.heightMeters / 2, 0], 0.05, def.heightMeters, [0.6, 0.63, 0.67]),
      box([0, def.heightMeters - 0.32, -0.04], [1.5, 0.44, 0.03], [0.08, 0.42, 0.26]),
    ];
    case 'stopSign': return [
      cylinder8([0, 0.06, 0], 0.14, 0.12, [0.38, 0.4, 0.44]),
      cylinder8([0, def.heightMeters / 2, 0], 0.05, def.heightMeters, [0.55, 0.57, 0.6]),
      cylinder8([0, def.heightMeters - 0.5, 0.005], 0.45, 0.04, [0.88, 0.89, 0.87], [90, 0, 22.5]),
      cylinder8([0, def.heightMeters - 0.5, -0.02], 0.4, 0.05, [0.75, 0.14, 0.12], [90, 0, 22.5]),
    ];
    case 'streetLight': return [
      cylinder16([0, 0.15, 0], 0.2, 0.3, [0.16, 0.18, 0.21]),
      cylinder16([0, (def.heightMeters - 0.3) / 2 + 0.3, 0], 0.085, def.heightMeters - 0.3, [0.23, 0.25, 0.29]),
      cylinder8([0, def.heightMeters - 0.1, -0.575], 0.05, 1.15, [0.23, 0.25, 0.29], [90, 0, 0]),
      box([0, def.heightMeters - 0.12, -1.15], [0.22, 0.12, 0.4], [0.29, 0.31, 0.34]),
      box([0, def.heightMeters - 0.19, -1.15], [0.16, 0.04, 0.3], [1, 0.95, 0.76]),
    ];
    // TRAFFIC-HEAD-0610 (user report): the arm cantilevers SIDEWAYS (+X) over
    // the road; the head hangs at its end with the lamps facing -Z at yaw 0 —
    // the same facing world/traffic.ts gates the lane by. Mirrors the live
    // model (hmsc/render3d/props/TrafficLight.tsx).
    case 'trafficLight': return [
      cylinder16([0, 0.17, 0], 0.24, 0.34, [0.14, 0.15, 0.17]),
      cylinder16([0, (def.heightMeters - 0.34) / 2 + 0.34, 0], 0.1, def.heightMeters - 0.34, [0.2, 0.22, 0.24]),
      cylinder8([0.7, def.heightMeters - 0.25, 0], 0.06, 1.4, [0.2, 0.22, 0.24], [0, 0, 90]),
      box([1.4, def.heightMeters - 0.85, 0], [0.36, 1.12, 0.3], [0.1, 0.11, 0.12]),
      cylinder16([1.4, def.heightMeters - 0.5, -0.17], 0.13, 0.07, [1, 0.23, 0.19], [90, 0, 0]),
      cylinder16([1.4, def.heightMeters - 0.85, -0.17], 0.13, 0.07, [1, 0.82, 0.23], [90, 0, 0]),
      cylinder16([1.4, def.heightMeters - 1.2, -0.17], 0.13, 0.07, [0.21, 0.84, 0.36], [90, 0, 0]),
    ];
    case 'payphone': {
      const s = def.heightMeters / 1.45;
      return [
        cylinder8([0, 0.5 * s, 0], 0.05 * s, 1.0 * s, [0.6, 0.62, 0.64]),
        box([0, 1.12 * s, 0], [0.42 * s, 0.6 * s, 0.22 * s], [0.84, 0.86, 0.88]),
        box([0, 1.46 * s, -0.04 * s], [0.5 * s, 0.16 * s, 0.34 * s], [0.18, 0.43, 0.69]),
        box([0, 1.3 * s, 0.1 * s], [0.5 * s, 0.34 * s, 0.06 * s], [0.13, 0.31, 0.5]),
        box([0, 1.14 * s, -0.12 * s], [0.3 * s, 0.42 * s, 0.04 * s], [0.12, 0.14, 0.17]),
        box([-0.24 * s, 1.12 * s, -0.06 * s], [0.08 * s, 0.34 * s, 0.08 * s], [0.09, 0.1, 0.11]),
      ];
    }
    case 'mailbox': {
      const s = def.heightMeters / 1.3;
      return [
        cylinder8([0, 0.475 * s, 0], 0.06 * s, 0.95 * s, [0.42, 0.35, 0.26]),
        cylinder16([0, 1.04 * s, 0], 0.18 * s, 0.42 * s, [0.61, 0.64, 0.69], [90, 0, 0]),
        cylinder16([0, 1.04 * s, 0.22 * s], 0.18 * s, 0.03 * s, [0.47, 0.5, 0.55], [90, 0, 0]),
        cylinder16([0, 1.04 * s, -0.22 * s], 0.18 * s, 0.03 * s, [0.47, 0.5, 0.55], [90, 0, 0]),
        box([0.2 * s, 1.08 * s, 0.06 * s], [0.02 * s, 0.16 * s, 0.08 * s], [0.76, 0.23, 0.13]),
      ];
    }
    case 'fence': {
      const s = def.heightMeters / 1.2;
      const halfSpan = def.footprintRadiusMeters * 0.95;
      return [
        cylinder8([-halfSpan, def.heightMeters / 2, 0], 0.05 * s, def.heightMeters, [0.42, 0.45, 0.5]),
        sphere([-halfSpan, def.heightMeters + 0.015 * s, 0], [0.13 * s, 0.13 * s, 0.13 * s], [0.33, 0.36, 0.41]),
        cylinder8([halfSpan, def.heightMeters / 2, 0], 0.05 * s, def.heightMeters, [0.42, 0.45, 0.5]),
        sphere([halfSpan, def.heightMeters + 0.015 * s, 0], [0.13 * s, 0.13 * s, 0.13 * s], [0.33, 0.36, 0.41]),
        cylinder8([0, def.heightMeters - 0.04 * s, 0], 0.025 * s, halfSpan * 2, [0.61, 0.64, 0.69], [0, 0, 90]),
        cylinder8([0, 0.06 * s, 0], 0.025 * s, halfSpan * 2, [0.61, 0.64, 0.69], [0, 0, 90]),
        box([0, (def.heightMeters - 0.14 * s) / 2 + 0.06 * s, 0], [halfSpan * 2, def.heightMeters - 0.14 * s, 0.02 * s], [0.69, 0.72, 0.77]),
      ];
    }
    case 'fireHydrant': {
      // Mirrors the live model (hmsc/render3d/props/FireHydrant.tsx): base
      // flange, barrel, squashed-sphere dome, bonnet + cap nut (the live
      // cone reads as a small cylinder here — no cone instance shape),
      // front pumper nozzle, two side outlets. Prop yaw rides propRotation.
      const s = def.heightMeters / 0.78;
      const red: Color = [0xc2 / 255, 0x36 / 255, 0x2f / 255];
      const redDark: Color = [0x9c / 255, 0x2a / 255, 0x25 / 255];
      const cap: Color = [0xc9 / 255, 0xcc / 255, 0xd1 / 255];
      return [
        cylinder16([0, 0.03 * s, 0], 0.2 * s, 0.06 * s, redDark),
        cylinder16([0, 0.31 * s, 0], 0.13 * s, 0.46 * s, red),
        sphere([0, 0.56 * s, 0], [0.31 * s, 0.217 * s, 0.31 * s], red),
        cylinder8([0, 0.67 * s, 0], 0.075 * s, 0.1 * s, redDark),
        cylinder8([0, 0.75 * s, 0], 0.07 * s, 0.08 * s, cap),
        cylinder8([0, 0.42 * s, -0.15 * s], 0.055 * s, 0.14 * s, cap, [90, 0, 0]),
        cylinder8([0.15 * s, 0.46 * s, 0], 0.05 * s, 0.12 * s, cap, [0, 0, 90]),
        cylinder8([-0.15 * s, 0.46 * s, 0], 0.05 * s, 0.12 * s, cap, [0, 0, 90]),
      ];
    }
    // ── trees (mirror hmsc-int/render3d/props/Tree.tsx) ───────────────────
    case 'treeOak': {
      const h = def.heightMeters;
      const r = def.footprintRadiusMeters;
      const c = h * 0.32;
      const bark: Color = [0x5c / 255, 0x46 / 255, 0x31 / 255];
      const dark: Color = [0x1f / 255, 0x4a / 255, 0x20 / 255];
      const mid: Color = [0x2f / 255, 0x6b / 255, 0x2f / 255];
      const light: Color = [0x43 / 255, 0x88 / 255, 0x3a / 255];
      return [
        cylinder8([0, h * 0.24, 0], r, h * 0.48, bark),
        sphere([0, h * 0.66, 0], [c * 2, c * 1.7, c * 2], mid),
        sphere([c * 0.7, h * 0.58, c * 0.25], [c * 1.3, c * 1.1, c * 1.3], dark),
        sphere([-c * 0.65, h * 0.6, -c * 0.3], [c * 1.2, c, c * 1.2], light),
        sphere([c * 0.15, h * 0.62, -c * 0.7], [c * 1.1, c, c * 1.1], dark),
        sphere([-c * 0.2, h * 0.6, c * 0.68], [c * 1.1, c * 0.96, c * 1.1], light),
        sphere([0, h * 0.84, 0], [c * 1.1, c * 0.9, c * 1.1], mid),
      ];
    }
    case 'treePine': {
      const h = def.heightMeters;
      const r = def.footprintRadiusMeters;
      const barkDark: Color = [0x4a / 255, 0x38 / 255, 0x26 / 255];
      const pineDark: Color = [0x1d / 255, 0x3d / 255, 0x24 / 255];
      const pineMid: Color = [0x26 / 255, 0x51 / 255, 0x2e / 255];
      const parts: PropPartSpec[] = [cylinder8([0, h * 0.16, 0], r, h * 0.32, barkDark)];
      // No cone instance shape — each canopy tier is two stacked cylinders.
      const tiers: [number, number, number, Color][] = [
        [h * 0.38, h * 0.21, h * 0.36, pineDark],
        [h * 0.6, h * 0.165, h * 0.32, pineMid],
        [h * 0.82, h * 0.115, h * 0.3, pineDark],
      ];
      for (const [y, tierR, tierH, color] of tiers) {
        parts.push(cylinder8([0, y - tierH * 0.2, 0], tierR * 0.85, tierH * 0.55, color));
        parts.push(cylinder8([0, y + tierH * 0.18, 0], tierR * 0.5, tierH * 0.55, color));
      }
      return parts;
    }
    case 'treeBirch': {
      const h = def.heightMeters;
      const r = def.footprintRadiusMeters;
      const c = h * 0.22;
      const pale: Color = [0xd8 / 255, 0xd4 / 255, 0xc8 / 255];
      const barkDark: Color = [0x4a / 255, 0x38 / 255, 0x26 / 255];
      const leafPale: Color = [0x6a / 255, 0xa8 / 255, 0x4f / 255];
      const leafLight: Color = [0x43 / 255, 0x88 / 255, 0x3a / 255];
      return [
        cylinder8([0, h * 0.31, 0], r, h * 0.62, pale),
        box([0, h * 0.18, 0], [r * 2.1, h * 0.025, r * 2.1], barkDark),
        box([0, h * 0.34, 0], [r * 2.1, h * 0.025, r * 2.1], barkDark, [0, 30, 0]),
        box([0, h * 0.5, 0], [r * 2.1, h * 0.025, r * 2.1], barkDark, [0, 60, 0]),
        sphere([0, h * 0.74, 0], [c * 2, c * 2.3, c * 2], leafPale),
        sphere([c * 0.55, h * 0.68, c * 0.3], [c * 1.2, c * 1.4, c * 1.2], leafLight),
        sphere([-c * 0.5, h * 0.7, -c * 0.35], [c * 1.1, c * 1.3, c * 1.1], leafPale),
      ];
    }
    case 'treeCypress': {
      const h = def.heightMeters;
      const r = def.footprintRadiusMeters;
      const barkDark: Color = [0x4a / 255, 0x38 / 255, 0x26 / 255];
      const pineDark: Color = [0x1d / 255, 0x3d / 255, 0x24 / 255];
      const pineMid: Color = [0x26 / 255, 0x51 / 255, 0x2e / 255];
      return [
        cylinder8([0, h * 0.07, 0], r * 0.6, h * 0.14, barkDark),
        sphere([0, h * 0.5, 0], [h * 0.26, h * 0.84, h * 0.26], pineDark),
        sphere([h * 0.04, h * 0.4, -h * 0.03], [h * 0.22, h * 0.6, h * 0.22], pineMid),
        sphere([0, h * 0.78, 0], [h * 0.18, h * 0.44, h * 0.18], pineMid),
      ];
    }
    case 'treePalm': {
      const h = def.heightMeters;
      const r = def.footprintRadiusMeters;
      const bark: Color = [0x5c / 255, 0x46 / 255, 0x31 / 255];
      const barkDark: Color = [0x4a / 255, 0x38 / 255, 0x26 / 255];
      const frondColor: Color = [0x3a / 255, 0x7d / 255, 0x36 / 255];
      const pineMid: Color = [0x26 / 255, 0x51 / 255, 0x2e / 255];
      const lean = h * 0.18;
      const segH = (h * 0.92) / 4;
      const parts: PropPartSpec[] = [];
      for (let i = 0; i < 4; i += 1) {
        const t = i / 4;
        parts.push(cylinder8([lean * (t + 0.125), segH * (i + 0.5), 0], r * (1 - t * 0.35), segH * 1.1, i % 2 === 0 ? bark : barkDark));
      }
      const frondLength = h * 0.34;
      for (let i = 0; i < 7; i += 1) {
        const a = (i / 7) * 360;
        const rad = a * Math.PI / 180;
        const reach = frondLength * 0.55;
        parts.push({
          shape: 'sphere',
          local: [lean + Math.cos(rad) * reach, h * 0.9, Math.sin(rad) * reach],
          size: [frondLength * 2, h * 0.05, frondLength * 0.44],
          color: frondColor,
          rotation: [0, -a, 0],
        });
      }
      parts.push(sphere([lean, h * 0.92, 0], [h * 0.12, h * 0.1, h * 0.12], pineMid));
      parts.push(sphere([lean + h * 0.035, h * 0.885, h * 0.02], [h * 0.056, h * 0.056, h * 0.056], barkDark));
      parts.push(sphere([lean - h * 0.03, h * 0.885, -h * 0.025], [h * 0.056, h * 0.056, h * 0.056], barkDark));
      return parts;
    }
    case 'treeDead': {
      const h = def.heightMeters;
      const r = def.footprintRadiusMeters;
      const wood: Color = [0x6e / 255, 0x5d / 255, 0x4b / 255];
      const barkDark: Color = [0x4a / 255, 0x38 / 255, 0x26 / 255];
      const parts: PropPartSpec[] = [cylinder8([0, h * 0.46, 0], r, h * 0.92, wood)];
      const branches: [number, number, number, number][] = [
        [h * 0.55, 20, 55, h * 0.4],
        [h * 0.68, 150, 48, h * 0.34],
        [h * 0.78, 265, 40, h * 0.3],
        [h * 0.88, 80, 25, h * 0.24],
      ];
      branches.forEach(([y, angle, tilt, length], index) => {
        const rad = angle * Math.PI / 180;
        const tiltRad = tilt * Math.PI / 180;
        const reach = (length / 2) * Math.sin(tiltRad);
        parts.push(cylinder8(
          [Math.cos(rad) * reach, y + (length / 2) * Math.cos(tiltRad), Math.sin(rad) * reach],
          r * 0.32, length, index % 2 === 0 ? wood : barkDark,
          [Math.sin(rad) * tilt, 0, -Math.cos(rad) * tilt],
        ));
      });
      return parts;
    }
    // ── rock forms (mirror hmsc-int/render3d/props/Rock.tsx) ──────────────
    case 'boulder': case 'rockFlat': case 'rockSpire': case 'rockMossy': case 'rockPile': {
      const h = def.heightMeters;
      const r = def.footprintRadiusMeters;
      const stone: Color = [0x6b / 255, 0x70 / 255, 0x79 / 255];
      const stoneDark: Color = [0x52 / 255, 0x56 / 255, 0x5d / 255];
      const stoneLight: Color = [0x82 / 255, 0x86 / 255, 0x8d / 255];
      const moss: Color = [0x3f / 255, 0x6b / 255, 0x33 / 255];
      const mossLight: Color = [0x55 / 255, 0x8a / 255, 0x42 / 255];
      // [x, y, z, radius, squash, color]
      const recipes: Record<string, [number, number, number, number, number, Color][]> = {
        boulder: [
          [0, h * 0.45, 0, r * 0.92, 0.92, stone],
          [r * 0.45, h * 0.3, -r * 0.3, r * 0.6, 0.8, stoneDark],
          [-r * 0.5, h * 0.28, r * 0.35, r * 0.55, 0.75, stoneLight],
          [-r * 0.12, h * 0.68, -r * 0.2, r * 0.5, 0.8, stoneDark],
          [r * 0.2, h * 0.6, r * 0.4, r * 0.42, 0.72, stoneLight],
        ],
        rockFlat: [
          [0, h * 0.5, 0, r * 0.98, 0.5, stone],
          [r * 0.35, h * 0.55, r * 0.25, r * 0.6, 0.5, stoneLight],
          [-r * 0.4, h * 0.45, -r * 0.2, r * 0.62, 0.48, stoneDark],
        ],
        rockSpire: [
          [0, h * 0.2, 0, r * 0.95, 1.1, stoneDark],
          [r * 0.06, h * 0.5, -r * 0.04, r * 0.72, 1.4, stone],
          [-r * 0.05, h * 0.78, r * 0.05, r * 0.48, 1.5, stoneLight],
          [r * 0.03, h * 0.94, 0, r * 0.26, 1.3, stone],
        ],
        rockMossy: [
          [0, h * 0.42, 0, r * 0.95, 0.78, stone],
          [r * 0.5, h * 0.3, -r * 0.35, r * 0.62, 0.72, stoneDark],
          [-r * 0.48, h * 0.26, r * 0.4, r * 0.58, 0.7, stoneLight],
          [0, h * 0.62, 0, r * 0.72, 0.4, moss],
          [r * 0.42, h * 0.5, -r * 0.28, r * 0.42, 0.36, mossLight],
          [-r * 0.35, h * 0.46, r * 0.3, r * 0.38, 0.34, moss],
        ],
        rockPile: [
          [0, h * 0.5, 0, r * 0.5, 0.85, stone],
          [r * 0.55, h * 0.3, r * 0.2, r * 0.38, 0.8, stoneDark],
          [-r * 0.5, h * 0.32, -r * 0.25, r * 0.4, 0.78, stoneLight],
          [r * 0.2, h * 0.28, -r * 0.55, r * 0.34, 0.75, stone],
          [-r * 0.25, h * 0.26, r * 0.55, r * 0.32, 0.72, stoneDark],
          [r * 0.6, h * 0.22, -r * 0.35, r * 0.26, 0.7, stoneLight],
          [-r * 0.65, h * 0.2, r * 0.1, r * 0.24, 0.68, stone],
        ],
      };
      return recipes[prop.kind].map(([x, y, z, radius, squash, color]) =>
        sphere([x, y, z], [radius * 2, radius * 2 * squash, radius * 2], color));
    }
    // ── balls (mirror hmsc-int/render3d/props/Ball.tsx) ───────────────────
    case 'ballBeach': {
      const R = def.footprintRadiusMeters;
      return [
        sphere([0, R, 0], [R * 2, R * 2, R * 2], [0xf4 / 255, 0xf1 / 255, 0xe8 / 255]),
        cylinder16([0, R, 0], R * 1.02, R * 0.36, [0xe0 / 255, 0x45 / 255, 0x2f / 255]),
        cylinder16([0, R, 0], R * 1.02, R * 0.36, [0x2f / 255, 0x6f / 255, 0xe0 / 255], [90, 0, 0]),
      ];
    }
    case 'ballSoccer': {
      const R = def.footprintRadiusMeters;
      const patch: Color = [0x1c / 255, 0x1c / 255, 0x20 / 255];
      const parts: PropPartSpec[] = [sphere([0, R, 0], [R * 2, R * 2, R * 2], [0xf0 / 255, 0xf0 / 255, 0xee / 255])];
      const spots: [number, number][] = [[0, 65], [80, 20], [160, 45], [240, 15], [320, 40]];
      for (const [azimuth, elevation] of spots) {
        const a = azimuth * Math.PI / 180;
        const e = elevation * Math.PI / 180;
        parts.push(sphere(
          [Math.cos(e) * Math.cos(a) * R * 0.86, R + Math.sin(e) * R * 0.86, Math.cos(e) * Math.sin(a) * R * 0.86],
          [R * 0.6, R * 0.6, R * 0.6], patch,
        ));
      }
      return parts;
    }
    case 'ballBasketball': {
      const R = def.footprintRadiusMeters;
      const seam: Color = [0x2a / 255, 0x1c / 255, 0x12 / 255];
      return [
        sphere([0, R, 0], [R * 2, R * 2, R * 2], [0xd3 / 255, 0x72 / 255, 0x2c / 255]),
        cylinder16([0, R, 0], R * 1.01, R * 0.07, seam),
        cylinder16([0, R, 0], R * 1.01, R * 0.07, seam, [90, 0, 0]),
        cylinder16([0, R, 0], R * 1.01, R * 0.07, seam, [90, 90, 0]),
      ];
    }
    // ── wall decor (mirror hmsc-int/render3d/props/WallDecor.tsx) ─────────
    case 'wallPainting': {
      const frame: Color = [0x3d / 255, 0x2b / 255, 0x1c / 255];
      const frameLight: Color = [0x5a / 255, 0x41 / 255, 0x28 / 255];
      return [
        box([0, 1.5, -0.03], [1.25, 0.95, 0.05], frame),
        box([0, 1.5, -0.055], [1.15, 0.85, 0.02], frameLight),
        box([0, 1.66, -0.065], [1.05, 0.43, 0.01], [0x7f / 255, 0xb2 / 255, 0xd8 / 255]),
        box([0, 1.29, -0.065], [1.05, 0.33, 0.01], [0x5d / 255, 0x8a / 255, 0x4a / 255]),
        box([0.3, 1.7, -0.072], [0.16, 0.16, 0.005], [0xf2 / 255, 0xd2 / 255, 0x7a / 255]),
      ];
    }
    case 'ledLight': {
      const mount: Color = [0x2a / 255, 0x2d / 255, 0x33 / 255];
      return [
        box([0, 2.3, -0.03], [0.1, 0.06, 0.06], mount),
        box([0, 0.9, -0.03], [0.1, 0.06, 0.06], mount),
        cylinder8([0, 1.6, -0.07], 0.045, 1.4, [0x5f / 255, 0xf2 / 255, 1]),
      ];
    }
    // ── furniture (mirror hmsc-int/render3d/props/Furniture.tsx) ──────────
    case 'chair': case 'chairRed': case 'chairBlue': case 'chairGreen': {
      // Painted variants share the chair body; wood keeps wood legs, painted
      // chairs get dark metal legs (mirrors render3d/props/Furniture.tsx).
      const paints: Record<string, Color> = {
        chairRed: [0xb0 / 255, 0x3a / 255, 0x2e / 255],
        chairBlue: [0x2e / 255, 0x6f / 255, 0xb0 / 255],
        chairGreen: [0x3a / 255, 0x8f / 255, 0x4f / 255],
      };
      const wood: Color = [0x8a / 255, 0x62 / 255, 0x40 / 255];
      const woodDark: Color = [0x6b / 255, 0x4a / 255, 0x2e / 255];
      const metal: Color = [0x3a / 255, 0x3f / 255, 0x46 / 255];
      const body = paints[prop.kind] ?? wood;
      const legs = paints[prop.kind] ? metal : woodDark;
      return [
        box([0.2, 0.225, 0.2], [0.05, 0.45, 0.05], legs),
        box([-0.2, 0.225, 0.2], [0.05, 0.45, 0.05], legs),
        box([0.2, 0.225, -0.2], [0.05, 0.45, 0.05], legs),
        box([-0.2, 0.225, -0.2], [0.05, 0.45, 0.05], legs),
        box([0, 0.45, 0], [0.5, 0.06, 0.5], body),
        box([0, 0.72, 0.23], [0.5, 0.5, 0.05], body, [-6, 0, 0]),
      ];
    }
    case 'couch': {
      const w = def.footprintRadiusMeters * 2;
      const woodDark: Color = [0x6b / 255, 0x4a / 255, 0x2e / 255];
      const cushion: Color = [0x7d / 255, 0x4f / 255, 0x43 / 255];
      const cushionLight: Color = [0x96 / 255, 0x60 / 255, 0x4f / 255];
      return [
        box([0, 0.18, 0], [w, 0.3, 0.85], woodDark),
        box([-w * 0.225, 0.4, -0.05], [w * 0.42, 0.16, 0.7], cushion),
        box([w * 0.225, 0.4, -0.05], [w * 0.42, 0.16, 0.7], cushionLight),
        box([0, 0.55, 0.34], [w, 0.6, 0.22], cushion, [-4, 0, 0]),
        box([-w * 0.46, 0.45, 0], [w * 0.09, 0.55, 0.8], cushionLight),
        box([w * 0.46, 0.45, 0], [w * 0.09, 0.55, 0.8], cushionLight),
      ];
    }
    case 'table': {
      const half = def.footprintRadiusMeters - 0.08;
      const topY = def.heightMeters - 0.04;
      const wood: Color = [0x8a / 255, 0x62 / 255, 0x40 / 255];
      const woodDark: Color = [0x6b / 255, 0x4a / 255, 0x2e / 255];
      return [
        box([half, topY / 2, half], [0.07, topY, 0.07], woodDark),
        box([-half, topY / 2, half], [0.07, topY, 0.07], woodDark),
        box([half, topY / 2, -half], [0.07, topY, 0.07], woodDark),
        box([-half, topY / 2, -half], [0.07, topY, 0.07], woodDark),
        box([0, topY + 0.02, 0], [def.footprintRadiusMeters * 2, 0.06, def.footprintRadiusMeters * 2], wood),
      ];
    }
    case 'floorLamp': {
      const h = def.heightMeters;
      const metal: Color = [0x3a / 255, 0x3f / 255, 0x46 / 255];
      return [
        cylinder16([0, 0.02, 0], 0.17, 0.04, metal),
        cylinder8([0, (h - 0.34) / 2 + 0.04, 0], 0.022, h - 0.34, metal),
        sphere([0, h - 0.26, 0], [0.14, 0.14, 0.14], [1, 0xe9 / 255, 0xa8 / 255]),
        cylinder16([0, h - 0.15, 0], 0.21, 0.3, [0xe8 / 255, 0xd9 / 255, 0xb0 / 255]),
      ];
    }
    case 'bench': {
      const w = def.footprintRadiusMeters * 2;
      const wood: Color = [0x8a / 255, 0x62 / 255, 0x40 / 255];
      const woodDark: Color = [0x6b / 255, 0x4a / 255, 0x2e / 255];
      const metal: Color = [0x3a / 255, 0x3f / 255, 0x46 / 255];
      return [
        box([-w * 0.44, 0.225, 0], [0.06, 0.45, 0.5], metal),
        box([w * 0.44, 0.225, 0], [0.06, 0.45, 0.5], metal),
        box([0, 0.45, -0.14], [w, 0.04, 0.13], wood),
        box([0, 0.45, 0.02], [w, 0.04, 0.13], woodDark),
        box([0, 0.45, 0.18], [w, 0.04, 0.13], wood),
        box([0, 0.69, 0.26], [w, 0.12, 0.04], wood, [-12, 0, 0]),
        box([0, 0.83, 0.29], [w, 0.12, 0.04], woodDark, [-12, 0, 0]),
      ];
    }
    // ── street furniture (mirror render3d/props/StreetFurniture.tsx) ──────
    case 'trafficCone': {
      const h = def.heightMeters;
      const orange: Color = [0xe8 / 255, 0x68 / 255, 0x2a / 255];
      return [
        box([0, h * 0.03, 0], [def.footprintRadiusMeters * 2, h * 0.06, def.footprintRadiusMeters * 2], orange),
        // No cone instance shape — three stacked cylinders narrowing upward.
        cylinder8([0, h * 0.26, 0], h * 0.185, h * 0.4, orange),
        cylinder8([0, h * 0.57, 0], h * 0.12, h * 0.34, orange),
        cylinder8([0, h * 0.83, 0], h * 0.064, h * 0.26, orange),
        cylinder8([0, h * 0.52, 0], h * 0.15, h * 0.11, [0xf2 / 255, 0xef / 255, 0xe8 / 255]),
      ];
    }
    case 'barrier': {
      const w = def.footprintRadiusMeters * 2;
      const h = def.heightMeters;
      const concrete: Color = [0x9a / 255, 0x9a / 255, 0x92 / 255];
      const concreteDark: Color = [0x82 / 255, 0x82 / 255, 0x7a / 255];
      return [
        box([0, h * 0.14, 0], [w, h * 0.28, 0.6], concreteDark),
        box([0, h * 0.47, 0], [w, h * 0.42, 0.4], concrete),
        box([0, h * 0.85, 0], [w, h * 0.3, 0.24], concrete),
        box([-w * 0.3, h * 0.1, 0], [0.18, h * 0.12, 0.62], concreteDark),
        box([w * 0.3, h * 0.1, 0], [0.18, h * 0.12, 0.62], concreteDark),
      ];
    }
    case 'trashCan': {
      const h = def.heightMeters;
      const r = def.footprintRadiusMeters;
      const body: Color = [0x3f / 255, 0x57 / 255, 0x47 / 255];
      const dark: Color = [0x32 / 255, 0x46 / 255, 0x3a / 255];
      return [
        cylinder16([0, h * 0.41, 0], r * 0.92, h * 0.78, body),
        cylinder16([0, h * 0.82, 0], r, h * 0.05, dark),
        sphere([0, h * 0.84, 0], [r * 2, h * 0.45, r * 2], dark),
        box([0, h * 0.86, -r * 0.7], [r * 1.1, h * 0.16, 0.02], body, [18, 0, 0]),
      ];
    }
    case 'planter': {
      const h = def.heightMeters;
      const half = def.footprintRadiusMeters;
      const boxH = h * 0.7;
      const leafMid: Color = [0x2f / 255, 0x6b / 255, 0x2f / 255];
      const leafLight: Color = [0x43 / 255, 0x88 / 255, 0x3a / 255];
      return [
        box([0, boxH / 2, 0], [half * 2, boxH, half * 2], [0xa8 / 255, 0x59 / 255, 0x3a / 255]),
        box([0, boxH, 0], [half * 1.8, h * 0.06, half * 1.8], [0x3e / 255, 0x2f / 255, 0x22 / 255]),
        sphere([-half * 0.4, boxH + h * 0.18, -half * 0.2], [half * 0.8, h * 0.56, half * 0.8], leafMid),
        sphere([half * 0.35, boxH + h * 0.14, half * 0.25], [half * 0.76, h * 0.48, half * 0.76], leafLight),
        sphere([0, boxH + h * 0.22, 0], [half * 0.84, h * 0.6, half * 0.84], leafMid),
        sphere([-half * 0.45, boxH + h * 0.38, half * 0.15], [h * 0.12, h * 0.12, h * 0.12], [0xd6 / 255, 0x5d / 255, 0x8a / 255]),
        sphere([half * 0.4, boxH + h * 0.34, -half * 0.2], [h * 0.11, h * 0.11, h * 0.11], [0xe8 / 255, 0xc8 / 255, 0x4a / 255]),
      ];
    }
    // ── household (mirror hmsc-int/render3d/props/Furniture.tsx) ──────────
    case 'bedSingle': case 'bedDouble': {
      const double = prop.kind === 'bedDouble';
      const w = def.footprintRadiusMeters * 2;
      const d = double ? 1.5 : 1.0;
      const woodDark: Color = [0x6b / 255, 0x4a / 255, 0x2e / 255];
      const wood: Color = [0x8a / 255, 0x62 / 255, 0x40 / 255];
      const linen: Color = [0xec / 255, 0xe8 / 255, 0xdd / 255];
      const porcelain: Color = [0xee / 255, 0xf0 / 255, 0xf2 / 255];
      const blanket: Color = double ? [0x7d / 255, 0x3b / 255, 0x4a / 255] : [0x3a / 255, 0x7d / 255, 0x80 / 255];
      const parts: PropPartSpec[] = [
        box([0, 0.15, 0], [w, 0.3, d], woodDark),
        box([0, 0.39, 0], [w * 0.97, 0.18, d * 0.94], linen),
        box([-w * 0.16, 0.49, 0], [w * 0.62, 0.06, d * 0.96], blanket),
        box([w * 0.49, def.heightMeters / 2, 0], [0.07, def.heightMeters, d], wood),
      ];
      if (double) {
        parts.push(box([w * 0.36, 0.5, -d * 0.22], [w * 0.2, 0.1, d * 0.36], porcelain));
        parts.push(box([w * 0.36, 0.5, d * 0.22], [w * 0.2, 0.1, d * 0.36], porcelain));
      } else {
        parts.push(box([w * 0.36, 0.5, 0], [w * 0.2, 0.1, d * 0.55], porcelain));
      }
      return parts;
    }
    case 'cupboard': {
      const h = def.heightMeters;
      const w = def.footprintRadiusMeters * 2;
      const d = 0.5;
      const wood: Color = [0x8a / 255, 0x62 / 255, 0x40 / 255];
      const woodDark: Color = [0x6b / 255, 0x4a / 255, 0x2e / 255];
      const metal: Color = [0x3a / 255, 0x3f / 255, 0x46 / 255];
      return [
        box([0, 0.04, 0], [w, 0.08, d], woodDark),
        box([0, h / 2, 0], [w, h - 0.12, d - 0.06], wood),
        box([0, h - 0.03, 0], [w + 0.04, 0.06, d], woodDark),
        box([-w * 0.24, h * 0.52, -d / 2 + 0.015], [w * 0.44, h * 0.84, 0.02], woodDark),
        box([w * 0.24, h * 0.52, -d / 2 + 0.015], [w * 0.44, h * 0.84, 0.02], woodDark),
        box([-w * 0.06, h * 0.55, -d / 2 - 0.005], [0.035, 0.035, 0.035], metal),
        box([w * 0.06, h * 0.55, -d / 2 - 0.005], [0.035, 0.035, 0.035], metal),
      ];
    }
    case 'mirror': {
      const cy = 1.18;
      return [
        box([0, cy, -0.025], [0.62, 1.5, 0.04], [0x8c / 255, 0x92 / 255, 0x99 / 255]),
        box([0, cy, -0.05], [0.54, 1.42, 0.012], [0xbc / 255, 0xd6 / 255, 0xe2 / 255]),
        box([0.09, cy + 0.04, -0.058], [0.07, 1.25, 0.006], [0xe8 / 255, 0xf4 / 255, 0xfa / 255], [0, 0, 18]),
      ];
    }
    case 'sink': {
      const h = def.heightMeters;
      const porcelain: Color = [0xee / 255, 0xf0 / 255, 0xf2 / 255];
      const fixture: Color = [0xaa / 255, 0xb0 / 255, 0xb6 / 255];
      return [
        cylinder8([0, h * 0.39, 0], 0.09, h * 0.78, porcelain),
        sphere([0, h * 0.82, 0], [0.54, 0.23, 0.46], porcelain),
        box([0, h * 0.88, 0], [0.56, 0.04, 0.46], porcelain),
        cylinder8([0, h * 0.96, 0.16], 0.022, 0.16, fixture),
        cylinder8([0, h + 0.03, 0.09], 0.018, 0.14, fixture, [90, 0, 0]),
      ];
    }
    case 'oven': {
      const h = def.heightMeters;
      const w = def.footprintRadiusMeters * 2;
      const d = 0.62;
      const body: Color = [0xd6 / 255, 0xd9 / 255, 0xdc / 255];
      const dark: Color = [0xaa / 255, 0xb0 / 255, 0xb6 / 255];
      const black: Color = [0x22 / 255, 0x26 / 255, 0x2b / 255];
      const metal: Color = [0x3a / 255, 0x3f / 255, 0x46 / 255];
      return [
        box([0, h / 2, 0], [w, h, d], body),
        box([0, h, 0], [w, 0.025, d], black),
        cylinder8([-w * 0.22, h + 0.012, -0.14], 0.085, 0.02, [0x33 / 255, 0x37 / 255, 0x3c / 255]),
        cylinder8([w * 0.22, h + 0.012, -0.14], 0.085, 0.02, [0x33 / 255, 0x37 / 255, 0x3c / 255]),
        cylinder8([-w * 0.22, h + 0.012, 0.14], 0.085, 0.02, [0x33 / 255, 0x37 / 255, 0x3c / 255]),
        cylinder8([w * 0.22, h + 0.012, 0.14], 0.085, 0.02, [0x33 / 255, 0x37 / 255, 0x3c / 255]),
        box([0, h * 0.42, -d / 2 + 0.005], [w * 0.86, h * 0.5, 0.02], dark),
        box([0, h * 0.45, -d / 2 - 0.005], [w * 0.6, h * 0.26, 0.015], black),
        box([0, h * 0.72, -d / 2 - 0.02], [w * 0.8, 0.035, 0.035], metal),
      ];
    }
    case 'fridge': {
      const h = def.heightMeters;
      const w = def.footprintRadiusMeters * 2;
      const d = 0.72;
      const seamY = h * 0.68;
      const body: Color = [0xd6 / 255, 0xd9 / 255, 0xdc / 255];
      const dark: Color = [0xaa / 255, 0xb0 / 255, 0xb6 / 255];
      const black: Color = [0x22 / 255, 0x26 / 255, 0x2b / 255];
      return [
        box([0, 0.04, 0], [w * 0.9, 0.08, d * 0.9], black),
        box([0, h / 2 + 0.04, 0], [w, h - 0.08, d], body),
        box([0, seamY, -d / 2 + 0.002], [w, 0.02, 0.02], dark),
        box([-w * 0.34, seamY - h * 0.18, -d / 2 - 0.025], [0.035, h * 0.3, 0.035], dark),
        box([-w * 0.34, seamY + h * 0.1, -d / 2 - 0.025], [0.035, h * 0.14, 0.035], dark),
      ];
    }
    case 'computer': {
      const shell: Color = [0xcf / 255, 0xc8 / 255, 0xb4 / 255];
      const shellDark: Color = [0xb8 / 255, 0xb2 / 255, 0xa0 / 255];
      const screen: Color = [0x2c / 255, 0x4a / 255, 0x66 / 255];
      return [
        box([-0.05, 0.32, 0.06], [0.36, 0.3, 0.3], shell),
        box([-0.05, 0.32, -0.095], [0.3, 0.24, 0.012], screen),
        box([-0.05, 0.14, 0.06], [0.12, 0.06, 0.12], shellDark),
        box([-0.05, 0.1, 0.06], [0.24, 0.025, 0.2], shellDark),
        box([-0.05, 0.105, -0.21], [0.34, 0.025, 0.12], [0xd9 / 255, 0xd3 / 255, 0xc2 / 255], [4, 0, 0]),
        box([0.24, 0.27, 0.02], [0.16, 0.42, 0.38], [0xc4 / 255, 0xbd / 255, 0xa9 / 255]),
        box([0.24, 0.38, -0.175], [0.1, 0.03, 0.012], [0x22 / 255, 0x26 / 255, 0x2b / 255]),
      ];
    }
    // ── utility + sport (mirror render3d/props/StreetFurniture.tsx) ───────
    case 'telephonePole': {
      const h = def.heightMeters;
      const r = def.footprintRadiusMeters;
      const wood: Color = [0x4f / 255, 0x3d / 255, 0x2a / 255];
      const woodDark: Color = [0x3e / 255, 0x30 / 255, 0x21 / 255];
      const insulator: Color = [0x9a / 255, 0xa8 / 255, 0xb5 / 255];
      const parts: PropPartSpec[] = [cylinder8([0, h / 2, 0], r * 0.8, h, wood)];
      for (const [y, width] of [[h * 0.92, 1.7], [h * 0.82, 1.3]] as [number, number][]) {
        parts.push(box([0, y, 0], [width, 0.09, 0.09], woodDark));
        parts.push(cylinder8([-width * 0.42, y + 0.08, 0], 0.03, 0.1, insulator));
        parts.push(cylinder8([width * 0.42, y + 0.08, 0], 0.03, 0.1, insulator));
      }
      return parts;
    }
    case 'basketballHoop': {
      const h = def.heightMeters;
      const rimY = 3.05;
      const boardZ = -0.35;
      const pole: Color = [0x3a / 255, 0x3f / 255, 0x46 / 255];
      const board: Color = [0xe8 / 255, 0xea / 255, 0xec / 255];
      const rim: Color = [0xd3 / 255, 0x72 / 255, 0x2c / 255];
      return [
        cylinder8([0, (h - 0.4) / 2, 0], 0.07, h - 0.4, pole),
        box([0, h - 0.45, boardZ / 2], [0.06, 0.06, 0.42], pole, [14, 0, 0]),
        box([0, rimY + 0.32, boardZ], [1.1, 0.75, 0.04], board),
        box([0, rimY + 0.2, boardZ - 0.018], [0.45, 0.32, 0.015], rim),
        box([0, rimY + 0.19, boardZ - 0.02], [0.34, 0.22, 0.018], board),
        // No torus instance shape — the rim is a thin disc.
        cylinder16([0, rimY, boardZ - 0.26], 0.245, 0.035, rim),
      ];
    }
    default: {
      const box = PROP_BOX[prop.kind] ?? [def.footprintRadiusMeters * 2, def.heightMeters, def.footprintRadiusMeters * 2];
      return [{ shape: 'box', local: [0, box[1] / 2, 0], size: box, color: propColor(prop.kind) }];
    }
  }
}

function pushPropGeometry(b: Build, prop: WorldProp): number {
  return pushPropParts(b, prop, propParts(prop));
}

export function floorHasRelief(f: ChunkFloor): boolean {
  if (!f.heights || f.heights.length < Math.max(1, f.hcols) * Math.max(1, f.hrows)) return false;
  let min = Infinity;
  let max = -Infinity;
  for (const h of f.heights) {
    min = Math.min(min, h);
    max = Math.max(max, h);
  }
  return max - min > 0.001;
}

/** A chunk carries a road ribbon when roadRibbonSegments emitted ≥1 segment
 *  (8 floats each) for it. */
export function floorHasRoadRibbon(f: ChunkFloor): boolean {
  return !!(f.roads && f.roads.length >= 8);
}

/** Floors that render through the textured HEIGHTFIELD path rather than flat
 *  per-cell box slabs (RIBBONBAKE-0610): relief floors (always have) PLUS flat
 *  floors carrying a road ribbon — the box-slab path can only flat-fill a cell
 *  with its tile-kind colour, so the analytic ribbon (smooth band, lane lines,
 *  median, concrete shoulders) is lost and the compiled game shows blocky
 *  stamped tiles where the editor shows a road. Routing those chunks to the
 *  textured quad makes the game match the editor (the texture baker runs the
 *  same fragment logic via heightfieldTexelColor). Collision is unaffected — a
 *  flat chunk's collider is the whole-chunk plane (worldColliders.flatChunkField),
 *  independent of which cells render. */
export function floorNeedsHeightfieldRender(f: ChunkFloor): boolean {
  return floorHasRelief(f) || floorHasRoadRibbon(f);
}

function floorSurfaceColor(f: ChunkFloor): Color {
  const tcols = f.tileData[0] | 0;
  const trows = f.tileData[1] | 0;
  const palCount = f.tileData[2] | 0;
  if (tcols <= 0 || trows <= 0 || palCount <= 0) return [0.45, 0.5, 0.42];
  const palBase = 3;
  const idxBase = 3 + palCount * 3;
  let r = 0;
  let g = 0;
  let b = 0;
  let n = 0;
  for (let i = 0; i < tcols * trows; i += 1) {
    const v = f.tileData[idxBase + i] | 0;
    if (v < 0 || v >= palCount) continue;
    r += f.tileData[palBase + v * 3 + 0];
    g += f.tileData[palBase + v * 3 + 1];
    b += f.tileData[palBase + v * 3 + 2];
    n += 1;
  }
  return n > 0 ? [r / n, g / n, b / n] : [0.45, 0.5, 0.42];
}

function heightfieldTextureSize(f: ChunkFloor): { width: number; height: number; scale: number } {
  const tcols = f.tileData[0] | 0;
  const trows = f.tileData[1] | 0;
  if (tcols <= 0 || trows <= 0) return { width: 0, height: 0, scale: 0 };
  const scale = Math.max(1, Math.min(HEIGHTFIELD_TEXTURE_PIXELS_PER_TILE, Math.floor(HEIGHTFIELD_TEXTURE_MAX_PX / Math.max(tcols, trows))));
  return { width: tcols * scale, height: trows * scale, scale };
}

function heightfieldTextureBytes(f: ChunkFloor): Uint8Array {
  const { width, height } = heightfieldTextureSize(f);
  if (width <= 0 || height <= 0) return new Uint8Array(0);
  // Bake through the SAME fragment logic the editor's live shader runs: f.tileData
  // ([cols, rows, palCount, palette…, cell idx…]) is prefix-compatible with the
  // shader's data array; appending the ribbon section (header + segs) gives
  // heightfieldTexelColor everything it needs, so the baked texture is pixel-for-
  // pixel what the editor draws (RIBBONBAKE-0610). The texture is 4px/tile — the
  // same resolution as the editor's HeightfieldSurfaceCapture — so even the lane
  // lines and median land identically.
  const data = [...f.tileData, ...roadRibbonSection(f.roads)];
  const out = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    const v = (y + 0.5) / height;
    for (let x = 0; x < width; x += 1) {
      const u = (x + 0.5) / width;
      const [r, g, b] = heightfieldTexelColor(data, u, v);
      const o = (y * width + x) * 4;
      out[o + 0] = Math.max(0, Math.min(255, Math.round(r * 255)));
      out[o + 1] = Math.max(0, Math.min(255, Math.round(g * 255)));
      out[o + 2] = Math.max(0, Math.min(255, Math.round(b * 255)));
      out[o + 3] = 255;
    }
  }
  return out;
}

const BUILDING_HEIGHT: Record<string, number> = {
  house: 4,
  shop: 5,
  tower: 24,
  warehouse: 8,
  parkingGarage: 10,
  gasStation: 5,
  usedCarLot: 3,
  driveIn: 6,
};

function buildingColor(kind: BuildingKind | string): Color {
  switch (kind) {
    case 'tower':
      return [0.55, 0.6, 0.72];
    case 'house':
      return [0.72, 0.6, 0.5];
    case 'shop':
      return [0.62, 0.55, 0.72];
    case 'warehouse':
      return [0.5, 0.5, 0.56];
    case 'parkingGarage':
      return [0.55, 0.55, 0.58];
    case 'gasStation':
      return [0.8, 0.55, 0.4];
    case 'usedCarLot':
      return [0.5, 0.55, 0.6];
    default:
      return [0.6, 0.6, 0.62];
  }
}

// How each build MATERIAL reads — mirrors PlayRoute's MATERIAL_LOOK so the loader
// shows the same wall/floor/pillar colors the /test play view does.
const MATERIAL_COLOR: Record<BuildMaterial, Color> = {
  concrete: hexColor('#9aa3ad'),
  brick: hexColor('#8a4a3a'),
  stucco: hexColor('#d8cdb8'),
  wood: hexColor('#8a6a45'),
  metal: hexColor('#7d858d'),
  glass: hexColor('#cfe6f2'),
  chainlink: hexColor('#b9c2c9'),
};

// ── extrusion ───────────────────────────────────────────────────────────────

/** Extrude the GameState's painted world layers into box instances (the ground
 *  the editor preview shows: regions/roads/junctions/landforms/props). */
function pushWorldLayers(b: Build, state: GameState): void {
  const world = state.world;

  // Surface regions — flat colored ground slabs over their footprint.
  for (const region of world.surfaceRegions) {
    const w = Math.max(1, region.width);
    const d = Math.max(1, region.depth);
    pushBox(b, region.x + w / 2, region.y + 0.1, region.z + d / 2, w, 0.2, d, tileColor(region.kind));
  }

  // Placed single cells — small raised tiles with their own identity.
  for (const placed of Object.values(world.placedCells)) {
    const cell = placed.cell;
    pushBox(b, cell.x + 0.5, (cell.y ?? 0) + 0.2, cell.z + 0.5, 0.9, 0.4, 0.9, tileColor(placed.kind));
  }

  // Roads — asphalt slabs sized to their cross-section, run along their axis.
  const roadColor = tileColor('road');
  for (const road of world.roads) {
    const width = Math.max(2, solveRoadCrossSection(road.profile).totalWidthMeters);
    const length = Math.max(1, road.lengthTiles);
    if (road.orientation === 'northSouth') {
      pushBox(b, road.x + width / 2, road.y + 0.075, road.z + length / 2, width, 0.15, length, roadColor);
    } else {
      pushBox(b, road.x + length / 2, road.y + 0.075, road.z + width / 2, length, 0.15, width, roadColor);
    }
  }

  // Junctions — intersection box / cul-de-sac bulb, sized to the joining roads.
  const junctionColor = tileColor('asphalt');
  for (const junction of world.junctions) {
    if (junction.kind === 'intersection') {
      const w = Math.max(2, solveRoadCrossSection(junction.profile).totalWidthMeters);
      pushBox(b, junction.x + w / 2, junction.y + 0.08, junction.z + w / 2, w, 0.16, w, junctionColor);
    } else {
      const r = Math.max(1, junction.bulbRadiusTiles);
      pushBox(b, junction.centerX, junction.y + 0.08, junction.centerZ, r * 2, 0.16, r * 2, junctionColor);
    }
  }

  // Landforms (mountains/hills) are TERRAIN — /test draws them as draped
  // heightfield meshes via <Landform>, NOT as solid blocks. Extruding them to a
  // box produced a phantom floating "green building" that isn't in the map. Skip
  // them until the ~hf~ heightfield path lands (ship the height grid, host bakes
  // the mesh — see the map-format memory); a wrong box is worse than nothing.

  // Legacy authored buildings (usually empty; pieces are the real structures).
  for (const building of world.buildings ?? []) {
    const w = Math.max(1, building.widthTiles);
    const d = Math.max(1, building.depthTiles);
    const h = BUILDING_HEIGHT[building.kind] ?? 5;
    pushBox(b, building.x + w / 2, building.y + h / 2, building.z + d / 2, w, h, d, buildingColor(building.kind), building.yawDegrees ?? 0);
  }

  // Props — compile the semantic prop kind into the same visible parts the
  // runtime model uses where the loader's current box/ramp instance format can
  // represent it. This keeps authored dumpsters/signs/lights from collapsing to
  // one generic block in the no-V8 loader.
  for (const prop of world.props) {
    pushPropGeometry(b, prop);
  }
}

function pushPieceBox(
  b: Build,
  piece: PlacedBuildPiece,
  u: number,
  v: number,
  baseY: number,
  width: number,
  height: number,
  depth: number,
  color: Color,
  material = 0,
): void {
  const { dx, dz } = localOffset(u, v, piece.yawDegrees);
  pushBox(
    b,
    piece.x + dx,
    baseY + height / 2,
    piece.z + dz,
    width,
    height,
    depth,
    color,
    piece.yawDegrees,
    material,
  );
}

function isHorizontalSkinPiece(kind: string): boolean {
  return kind === 'floor' || kind === 'roof';
}

// Each face carries EITHER a material (the shader travels, interned) OR a flat
// color (a {kind:'color'} swatch, or the piece's fallback). A material face is
// still emitted with `fallback` as its color so a host without the materials
// vocab degrades to the base look instead of going invisible.
function pushSkinnedWallOrPlate(b: Build, piece: PlacedBuildPiece, fallback: Color): number {
  const def = GAME_BUILD.catalog.get(piece.pieceId);
  const size = def.size;
  const sides = skinColor(piece.skin?.sides, fallback);
  const front = skinColor(piece.skin?.front, fallback);
  const back = skinColor(piece.skin?.back, fallback);
  const sidesMat = faceMaterial(b, piece.skin?.sides, def.material);
  const frontMat = faceMaterial(b, piece.skin?.front, def.material);
  const backMat = faceMaterial(b, piece.skin?.back, def.material);
  const slab = BUILD_FACE_SLAB_THICKNESS_METERS;
  const lift = BUILD_FACE_SLAB_LIFT_METERS;

  if (isHorizontalSkinPiece(def.kind)) {
    const coreHeight = Math.max(0.01, size.heightMeters - lift * 2);
    pushPieceBox(b, piece, 0, 0, piece.y + lift, size.widthMeters, coreHeight, size.depthMeters, sides, sidesMat);
    pushPieceBox(b, piece, 0, 0, piece.y + size.heightMeters + lift - slab / 2, size.widthMeters, slab, size.depthMeters, front, frontMat);
    pushPieceBox(b, piece, 0, 0, piece.y - lift - slab / 2, size.widthMeters, slab, size.depthMeters, back, backMat);
    return 3;
  }

  if (GAME_BUILD.kinds.get(def.kind).edits === 'wall') {
    const frontV = size.depthMeters / 2 + lift;
    const backV = -size.depthMeters / 2 - lift;
    pushPieceBox(b, piece, 0, 0, piece.y, size.widthMeters, size.heightMeters, size.depthMeters, sides, sidesMat);
    pushPieceBox(b, piece, 0, frontV, piece.y, size.widthMeters, size.heightMeters, slab, front, frontMat);
    pushPieceBox(b, piece, 0, backV, piece.y, size.widthMeters, size.heightMeters, slab, back, backMat);
    return 3;
  }

  return 0;
}

/** Extrude the BUILD stream's PLACED PIECES into box instances — the city's
 *  structures (walls/floors/pillars/towers/prefabs). Wall and plate pieces emit
 *  the same core + face-slab boxes as /test so per-face skins survive the bake;
 *  simple pieces remain one body box. This is the parity-with-/test path. */
function pushPlacedPieces(b: Build, pieces: readonly PlacedBuildPiece[]): number {
  let emitted = 0;
  for (const piece of pieces) {
    let def;
    try {
      def = GAME_BUILD.catalog.get(piece.pieceId);
    } catch {
      continue; // unknown piece id — skip rather than abort the whole bake
    }
    const color = MATERIAL_COLOR[def.material] ?? [0.62, 0.64, 0.68];
    const size = def.size;
    if (def.kind === 'prop' && def.propKind) {
      emitted += pushPropGeometry(b, {
        id: piece.id,
        kind: def.propKind as WorldProp['kind'],
        x: piece.x,
        y: piece.y,
        z: piece.z,
        yawDegrees: piece.yawDegrees,
        createdByCommand: 'hmsc-int:compile-build-prop',
      });
      continue;
    }
    const skinnedBoxes = pushSkinnedWallOrPlate(b, piece, color);
    if (skinnedBoxes > 0) {
      emitted += skinnedBoxes;
      continue;
    }
    if (def.kind === 'ramp') {
      // Match /test: ramps render as the real inclined slab geometry and
      // collide as a slope heightfield, not as a bounding box.
      pushRamp(b, piece.x, piece.y, piece.z, size.widthMeters, size.heightMeters, size.depthMeters, color, piece.yawDegrees);
      emitted += 1;
      continue;
    }
    if (def.kind === 'stairs') {
      // Match /test: stairs are visually distinct stepped boxes, while their
      // collision remains the walkable slope heightfield.
      emitted += pushStairs(b, piece.x, piece.y, piece.z, size.widthMeters, size.heightMeters, size.depthMeters, color, piece.yawDegrees);
      continue;
    }
    // The play view's body box: center (x, y + h/2, z), full catalog size, yaw.
    // A non-wall single body (pillar/post/column) takes its material from the
    // 'sides' slot — the whole box wears one look.
    const bodyMat = faceMaterial(b, piece.skin?.sides, def.material);
    pushBox(
      b,
      piece.x,
      piece.y + size.heightMeters / 2,
      piece.z,
      size.widthMeters,
      size.heightMeters,
      size.depthMeters,
      color,
      piece.yawDegrees,
      bodyMat,
    );
    emitted += 1;
  }
  return emitted;
}

/** Rasterize the PAINTED FLOOR — the user's real, solid, walkable ground.
 *
 *  A painted chunk carries a per-1m-cell tile grid (`tileData` = [cols, rows,
 *  palCount, palette rgb…, …cell idx], -1 = empty) over a heightfield. Each
 *  cell's color is `palette[idx]` (the tile-kind colors the editor paints with),
 *  so this renders exactly what the user painted. Cells are merged into
 *  horizontal RUNS (row-RLE) so a solid fill is a few hundred slabs, not 14k
 *  tiles. Height is sampled from the chunk's height grid so a painted hill drapes
 *  too. This is the live ground (read from the map session payload), NOT the demo
 *  surfaceRegions. */
function pushPaintedFloors(build: Build, floors: readonly ChunkFloor[]): number {
  let emitted = 0;
  for (const f of floors) {
    if (floorNeedsHeightfieldRender(f)) continue; // road/relief chunks ship as textured heightfield quads
    const tcols = f.tileData[0] | 0;
    const trows = f.tileData[1] | 0;
    const palCount = f.tileData[2] | 0;
    if (tcols <= 0 || trows <= 0) continue;
    const palBase = 3;
    const idxBase = 3 + palCount * 3;
    const tileWorld = CHUNK_TILES / tcols; // meters per painted cell (≈1)
    const originX = f.cx * CHUNK_TILES;
    const originZ = f.cz * CHUNK_TILES;
    // Height sampling: nearest height-grid sample (heights span the chunk; hcols×
    // hrows with hCell meters between samples). Flat floors sample 0.
    const hcols = Math.max(1, f.hcols);
    const hrows = Math.max(1, f.hrows);
    const hCell = hcols > 1 ? CHUNK_TILES / (hcols - 1) : CHUNK_TILES;
    const heightAt = (worldX: number, worldZ: number): number => {
      if (!f.heights || f.heights.length < hcols * hrows) return 0;
      const hi = Math.min(hcols - 1, Math.max(0, Math.round((worldX - originX) / hCell)));
      const hj = Math.min(hrows - 1, Math.max(0, Math.round((worldZ - originZ) / hCell)));
      return f.heights[hj * hcols + hi] ?? 0;
    };
    for (let j = 0; j < trows; j += 1) {
      let i = 0;
      while (i < tcols) {
        const v = f.tileData[idxBase + j * tcols + i] | 0;
        if (v < 0) { i += 1; continue; } // empty cell — void shows through
        let i1 = i + 1;
        while (i1 < tcols && (f.tileData[idxBase + j * tcols + i1] | 0) === v) i1 += 1;
        const r = f.tileData[palBase + v * 3 + 0];
        const g = f.tileData[palBase + v * 3 + 1];
        const b = f.tileData[palBase + v * 3 + 2];
        const cx = originX + ((i + i1) / 2) * tileWorld;
        const cz = originZ + (j + 0.5) * tileWorld;
        const w = (i1 - i) * tileWorld;
        const y = heightAt(cx, cz);
        pushBox(build, cx, y + 0.05, cz, w, 0.1, tileWorld, [r, g, b]);
        emitted += 1;
        i = i1;
      }
    }
  }
  return emitted;
}

export function encodeFloorHeightfields(floors: readonly ChunkFloor[]): Uint8Array {
  const fields = floors.filter(floorNeedsHeightfieldRender);
  let bytes = 8;
  for (const f of fields) {
    const count = Math.max(0, f.hcols | 0) * Math.max(0, f.hrows | 0);
    const tex = heightfieldTextureSize(f);
    bytes += 16 + HEIGHTFIELD_RECORD_FLOATS * 4 + count * 4 + tex.width * tex.height * 4;
  }

  const out = new Uint8Array(bytes);
  const view = new DataView(out.buffer);
  view.setUint32(0, HEIGHTFIELD_LUMP_VERSION, true);
  view.setUint32(4, fields.length, true);
  let at = 8;
  for (const f of fields) {
    const cols = f.hcols | 0;
    const rows = f.hrows | 0;
    const count = cols * rows;
    const width = CHUNK_TILES;
    const depth = CHUNK_TILES;
    const cell = cols > 1 ? CHUNK_TILES / (cols - 1) : CHUNK_TILES;
    const color = floorSurfaceColor(f);
    const texture = heightfieldTextureBytes(f);
    const tex = heightfieldTextureSize(f);
    view.setUint32(at + 0, cols, true);
    view.setUint32(at + 4, rows, true);
    view.setUint32(at + 8, tex.width, true);
    view.setUint32(at + 12, tex.height, true);
    at += 16;
    const floats = [
      f.cx * CHUNK_TILES + CHUNK_TILES / 2,
      f.cz * CHUNK_TILES + CHUNK_TILES / 2,
      0,
      width,
      depth,
      cell,
      Math.cos((38 * Math.PI) / 180),
      color[0],
      color[1],
      color[2],
    ];
    for (let i = 0; i < floats.length; i += 1) view.setFloat32(at + i * 4, floats[i], true);
    at += HEIGHTFIELD_RECORD_FLOATS * 4;
    for (let i = 0; i < count; i += 1) view.setFloat32(at + i * 4, f.heights[i] ?? 0, true);
    at += count * 4;
    out.set(texture, at);
    at += texture.byteLength;
  }
  return out;
}

export type WorldInstanceResult = {
  instances: Float32Array;
  total: number;
  pieces: number;
  /** Per-instance-row material slot (1-based into `materials`; 0 = flat color).
   *  Length === total; parallel to the instance rows. */
  materialRefs: Uint32Array;
  /** The content-addressed material vocab the host materializes at load: each a
   *  WGSL shader + its data[] params. Empty when nothing is material-skinned. */
  materials: MaterialAsset[];
};

/** Build the packed instance buffer for the authored world.
 *
 *  The world is the user's authored content: the PLACED PIECES (the structures
 *  the build editor / /test render) PLUS the PAINTED FLOOR (the solid, walkable
 *  ground the user paints — read live from the map session as chunk tile fields).
 *  Pieces come FIRST so the loader frames the camera on them; the floor is the
 *  ground they stand on. Beyond the painted cells is void (you fall off the edge).
 *
 *  The GameState's painted layers (surfaceRegions / roads / props / landforms)
 *  are the SEPARATE legacy painted-world path. For a piece-based map they are
 *  unauthored demo scaffolding (createInitialGameState chunk regions + demo
 *  props) — phantom content — so they are OFF by default. `includeGroundLayers`
 *  is the opt-in for a genuinely painted map; the code is retained, not deleted. */
export function buildWorldInstances(
  state: GameState,
  pieces: readonly PlacedBuildPiece[] = [],
  floors: readonly ChunkFloor[] = [],
  opts: { includeGroundLayers?: boolean; decalAssets?: DecalAssetSink } = {},
): WorldInstanceResult {
  const b = newBuild(opts.decalAssets);
  const pieceCount = pushPlacedPieces(b, pieces);
  pushPaintedFloors(b, floors);
  if (opts.includeGroundLayers) pushWorldLayers(b, state);
  return {
    instances: new Float32Array(b.inst),
    total: Math.floor(b.inst.length / INSTANCE_STRIDE),
    pieces: pieceCount,
    materialRefs: Uint32Array.from(b.mats),
    materials: b.vocab,
  };
}

/** Encode the material-reference lump: u32 count | u32[count] (one 1-based
 *  material slot per instance row, 0 = flat color). Parallel to the instance
 *  lump's rows — the loader reads them in lockstep. */
export function encodeMaterialRefs(refs: Uint32Array): Uint8Array {
  const out = new Uint8Array(4 + refs.length * 4);
  const view = new DataView(out.buffer);
  view.setUint32(0, refs.length, true);
  for (let i = 0; i < refs.length; i += 1) view.setUint32(4 + i * 4, refs[i], true);
  return out;
}

/** The MATERIALS lump's decal-doc tail magic ('DOCS' LE) — see encodeMaterials. */
export const MATERIALS_DOC_TAIL_MAGIC = 0x53434f44;

/** Encode the materials vocab lump. The body ships RECIPES: u32 count, then
 *  per material: u32 wgsl byte length | wgsl utf8 | u32 data float count |
 *  f32[data] | f32 opacity. The host runs each shader at load to a 1-tile
 *  texture and samples it on the referencing faces; an empty wgsl with
 *  opacity<1 is a translucent flat material (glass) the host renders
 *  see-through.
 *  DECAL DOC TAIL (DECALRECIPE-0610, appended only when a material carries a
 *  packed DecalDoc — older payloads parse unchanged): u32 'DOCS' magic |
 *  u32 entryCount, then per entry: u32 materialIndex (0-based) |
 *  u32 docByteLen | the packed recipe (./decalPack layout; the loader
 *  rasterizes it at load — framework/gpu/decal_raster.zig). */
export function encodeMaterials(materials: readonly MaterialAsset[]): Uint8Array {
  // Bake breadcrumb (captured by the Compile button via 2>&1) so the user can SEE
  // what the data carries — separating "is glass in the gamefile" from "does the
  // loader render it". console.warn → stderr → the bake's merged output.
  const translucent = materials.filter((m) => m.opacity < 1).length;
  const shaders = materials.filter((m) => m.wgsl.length > 0).length;
  const decals = materials.filter((m) => m.doc).length;
  console.warn(`[materials] baked ${materials.length} material(s): ${shaders} shader, ${translucent} translucent, ${decals} decal recipe(s)`);
  // textBytes is the workspace's headless-safe utf8 encoder (the v8cli bake has
  // no TextEncoder; it falls back to encodeURIComponent). WGSL is ASCII anyway.
  const sources = materials.map((m) => textBytes(m.wgsl));
  let bytes = 4;
  for (let i = 0; i < materials.length; i += 1) {
    bytes += 4 + sources[i].byteLength + 4 + materials[i].data.length * 4 + 4;
  }
  if (decals > 0) {
    bytes += 8; // tail magic + entry count
    for (const m of materials) {
      if (m.doc) bytes += 8 + m.doc.byteLength;
    }
  }
  const out = new Uint8Array(bytes);
  const view = new DataView(out.buffer);
  view.setUint32(0, materials.length, true);
  let at = 4;
  for (let i = 0; i < materials.length; i += 1) {
    const src = sources[i];
    view.setUint32(at, src.byteLength, true); at += 4;
    out.set(src, at); at += src.byteLength;
    const data = materials[i].data;
    view.setUint32(at, data.length, true); at += 4;
    for (let k = 0; k < data.length; k += 1) { view.setFloat32(at, data[k], true); at += 4; }
    view.setFloat32(at, materials[i].opacity, true); at += 4;
  }
  if (decals > 0) {
    view.setUint32(at, MATERIALS_DOC_TAIL_MAGIC, true); at += 4;
    view.setUint32(at, decals, true); at += 4;
    for (let i = 0; i < materials.length; i += 1) {
      const doc = materials[i].doc;
      if (!doc) continue;
      view.setUint32(at, i, true); at += 4;
      view.setUint32(at, doc.byteLength, true); at += 4;
      out.set(doc, at); at += doc.byteLength;
    }
  }
  return out;
}

/** Encode the instance buffer as a map lump payload:
 *  u32 count | u32 stride | u32 pieceCount | f32[count*stride].
 *  `pieceCount` (the first N rows, the placed structures) lets the loader frame
 *  the camera on the city rather than the whole ground plane. */
export function encodeInstanceLump(instances: Float32Array, pieceCount = 0, stride: number = INSTANCE_STRIDE): Uint8Array {
  const count = Math.floor(instances.length / stride);
  const out = new Uint8Array(12 + count * stride * 4);
  const view = new DataView(out.buffer);
  view.setUint32(0, count, true);
  view.setUint32(4, stride, true);
  view.setUint32(8, Math.min(pieceCount, count), true);
  for (let i = 0; i < count * stride; i += 1) {
    view.setFloat32(12 + i * 4, instances[i], true);
  }
  return out;
}
