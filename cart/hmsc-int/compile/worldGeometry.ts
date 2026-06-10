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

import type { GameState, PropKind, BuildingKind, TileKind, WorldProp } from '../../hmsc/design';
import { propKindDefinition } from '../../hmsc/world/propKinds';
import { solveRoadCrossSection } from '../../hmsc/world/roadProfile';
import { tileKindDefinition } from '../../hmsc/world/tileKinds';
import { CHUNK_TILES } from '../chunks';
import type { ChunkFloor } from '../chunkFloor';
import { GAME_BUILD } from '@game';
import type { BuildFaceSkin, BuildMaterial, PlacedBuildPiece } from '@game';
import { shaderSpec, defaultShaderData } from '@game/textures/shaders';
import { loadCustomTextures, type CustomTexture } from '@game/textures/materials';
import { textBytes } from '@reactjit/workspace';

export const INSTANCE_STRIDE = 13;
export const INSTANCE_SHAPE_BOX = 0;
export const INSTANCE_SHAPE_RAMP = 1;

// ── materials: ship the SHADER (the formula), referenced — never baked pixels ─
// GUIDING_LIGHT: procedural content travels as its recipe. A face whose skin is
// a {kind:'material'} carries a WGSL shader + its data[] params; we intern each
// DISTINCT (shader, data) once (content-addressed by its key) into a vocab the
// host materializes at load (run the shader → a 1-tile texture → sample the
// face). The geometry stream stays flat color; a PARALLEL per-row material index
// (0 = none) references the vocab, so the instance stride and all physics/spawn
// code are untouched. Both built-in shader-catalog ids AND 'custom:' Materialized
// SHADER looks resolve in the headless bake (the custom store is plain localstore;
// loadCustomTextures is React-free). Decal/react-source customs still fall back to
// flat color — those have no WGSL to ship (the captured-pixel tail).
// A material the host materializes at load. `wgsl` is the shader recipe (empty
// for a TRANSLUCENT FLAT material like glass — no shader, just a tint + alpha the
// loader renders through the transparent pass). `opacity` < 1 marks translucency.
export type MaterialAsset = { key: string; wgsl: string; data: number[]; opacity: number };

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
function resolveMaterialShader(id: string): { wgsl: string; data: number[] } | null {
  const builtin = shaderSpec(id);
  if (builtin) return { wgsl: builtin.shader, data: defaultShaderData(builtin) };
  const custom = customById(id);
  if (custom?.shaderId !== undefined && custom.data !== undefined) {
    const spec = shaderSpec(custom.shaderId);
    if (spec) return { wgsl: spec.shader, data: custom.data }; // frozen tuned data
  }
  return null; // decal/react custom — no WGSL to ship; keep the flat color
}

// One geometry-build accumulator: the packed instance rows PLUS a parallel
// material index per row (interned vocab). They grow in lockstep — every push
// appends exactly one row and one material ref.
type Build = {
  inst: number[];
  mats: number[];
  vocab: MaterialAsset[];
  index: Map<string, number>; // material key → 1-based vocab slot (0 = none)
};

function newBuild(): Build {
  return { inst: [], mats: [], vocab: [], index: new Map() };
}

// Resolve a {kind:'material'} skin to its shipped recipe and intern it; return
// the 1-based vocab slot, or 0 when it can't travel (color skins, or a custom/
// react material the headless bake can't resolve — those keep their flat color).
function internMaterial(b: Build, skin: BuildFaceSkin | undefined): number {
  if (!skin || skin.kind !== 'material') return 0;
  const resolved = resolveMaterialShader(skin.id);
  if (!resolved) return 0; // decal/react material — keep the flat color
  const key = `${skin.id}|${resolved.data.join(',')}`;
  const existing = b.index.get(key);
  if (existing !== undefined) return existing;
  const slot = b.vocab.length + 1;
  b.vocab.push({ key, wgsl: resolved.wgsl, data: resolved.data, opacity: 1 });
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
  b.inst.push(cx, cy, cz, 0, yawDegrees, 0, sx, sy, sz, color[0], color[1], color[2], INSTANCE_SHAPE_BOX);
  b.mats.push(material);
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
  b.inst.push(x, y + height / 2, z, 0, yawDegrees, 0, width, height, depth, color[0], color[1], color[2], INSTANCE_SHAPE_RAMP);
  b.mats.push(material);
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

type PropBoxSpec = {
  local: readonly [number, number, number];
  size: readonly [number, number, number];
  color: Color;
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

function pushPropPart(b: Build, prop: WorldProp, part: PropBoxSpec): void {
  const p = propAt(prop, part.local);
  pushBox(b, p[0], p[1], p[2], part.size[0], part.size[1], part.size[2], part.color, prop.yawDegrees ?? 0);
}

function pushPropParts(b: Build, prop: WorldProp, parts: readonly PropBoxSpec[]): number {
  for (const part of parts) pushPropPart(b, prop, part);
  return parts.length;
}

function propBoxParts(prop: WorldProp): PropBoxSpec[] {
  const def = propKindDefinition(prop.kind);
  switch (prop.kind) {
    case 'dumpster': {
      const s = def.heightMeters / 1.2;
      const w = def.footprintRadiusMeters * 1.6 * s;
      const d = def.footprintRadiusMeters * 0.9 * s;
      return [
        { local: [0, 0.03 * s, 0], size: [w * 0.85, 0.06 * s, d * 0.8], color: [0x3a / 255, 0x4a / 255, 0x30 / 255] },
        { local: [0, 0.45 * s, 0], size: [w, 0.78 * s, d], color: [0x4a / 255, 0x5d / 255, 0x3f / 255] },
        { local: [0, 0.87 * s, 0], size: [w + 0.04 * s, 0.06 * s, d + 0.04 * s], color: [0x3a / 255, 0x4a / 255, 0x30 / 255] },
        { local: [0, 0.96 * s, d * 0.22], size: [w + 0.02 * s, 0.08 * s, d * 0.55], color: [0x55 / 255, 0x66 / 255, 0x49 / 255] },
        { local: [0, 0.96 * s, -d * 0.22], size: [w + 0.02 * s, 0.08 * s, d * 0.55], color: [0x45 / 255, 0x55 / 255, 0x3a / 255] },
        { local: [0, 0.62 * s, 0], size: [w + 0.02 * s, 0.04 * s, d + 0.02 * s], color: [0x3a / 255, 0x4a / 255, 0x30 / 255] },
        { local: [0, 0.32 * s, 0], size: [w + 0.02 * s, 0.04 * s, d + 0.02 * s], color: [0x3a / 255, 0x4a / 255, 0x30 / 255] },
        { local: [w * 0.46, 0.5 * s, d * 0.46], size: [0.06 * s, 0.5 * s, 0.06 * s], color: [0x7a / 255, 0x5c / 255, 0x3a / 255] },
      ];
    }
    case 'streetSign': return [
      { local: [0, 0.06, 0], size: [0.28, 0.12, 0.28], color: [0.42, 0.45, 0.48] },
      { local: [0, def.heightMeters / 2, 0], size: [0.1, def.heightMeters, 0.1], color: [0.6, 0.63, 0.67] },
      { local: [0, def.heightMeters - 0.32, -0.04], size: [1.5, 0.44, 0.04], color: [0.08, 0.42, 0.26] },
    ];
    case 'stopSign': return [
      { local: [0, 0.06, 0], size: [0.28, 0.12, 0.28], color: [0.38, 0.4, 0.44] },
      { local: [0, def.heightMeters / 2, 0], size: [0.1, def.heightMeters, 0.1], color: [0.55, 0.57, 0.6] },
      { local: [0, def.heightMeters - 0.5, 0], size: [0.9, 0.9, 0.05], color: [0.88, 0.89, 0.87] },
      { local: [0, def.heightMeters - 0.5, -0.03], size: [0.8, 0.8, 0.06], color: [0.75, 0.14, 0.12] },
    ];
    case 'streetLight': return [
      { local: [0, 0.15, 0], size: [0.4, 0.3, 0.4], color: [0.16, 0.18, 0.21] },
      { local: [0, def.heightMeters / 2, 0], size: [0.17, def.heightMeters - 0.3, 0.17], color: [0.23, 0.25, 0.29] },
      { local: [0, def.heightMeters - 0.1, -0.58], size: [0.1, 0.1, 1.15], color: [0.23, 0.25, 0.29] },
      { local: [0, def.heightMeters - 0.12, -1.15], size: [0.22, 0.12, 0.4], color: [0.29, 0.31, 0.34] },
      { local: [0, def.heightMeters - 0.19, -1.15], size: [0.16, 0.04, 0.3], color: [1, 0.95, 0.76] },
    ];
    case 'trafficLight': return [
      { local: [0, 0.17, 0], size: [0.48, 0.34, 0.48], color: [0.14, 0.15, 0.17] },
      { local: [0, def.heightMeters / 2, 0], size: [0.2, def.heightMeters - 0.34, 0.2], color: [0.2, 0.22, 0.24] },
      { local: [0, def.heightMeters - 0.25, -0.7], size: [0.12, 0.12, 1.4], color: [0.2, 0.22, 0.24] },
      { local: [0, def.heightMeters - 0.85, -1.4], size: [0.36, 1.12, 0.3], color: [0.1, 0.11, 0.12] },
      { local: [0, def.heightMeters - 0.5, -1.58], size: [0.18, 0.18, 0.04], color: [1, 0.23, 0.19] },
      { local: [0, def.heightMeters - 0.85, -1.58], size: [0.18, 0.18, 0.04], color: [1, 0.82, 0.23] },
      { local: [0, def.heightMeters - 1.2, -1.58], size: [0.18, 0.18, 0.04], color: [0.21, 0.84, 0.36] },
    ];
    case 'payphone': {
      const s = def.heightMeters / 1.45;
      return [
        { local: [0, 0.5 * s, 0], size: [0.1 * s, 1.0 * s, 0.1 * s], color: [0.6, 0.62, 0.64] },
        { local: [0, 1.12 * s, 0], size: [0.42 * s, 0.6 * s, 0.22 * s], color: [0.84, 0.86, 0.88] },
        { local: [0, 1.46 * s, -0.04 * s], size: [0.5 * s, 0.16 * s, 0.34 * s], color: [0.18, 0.43, 0.69] },
        { local: [0, 1.3 * s, 0.1 * s], size: [0.5 * s, 0.34 * s, 0.06 * s], color: [0.13, 0.31, 0.5] },
        { local: [0, 1.14 * s, -0.12 * s], size: [0.3 * s, 0.42 * s, 0.04 * s], color: [0.12, 0.14, 0.17] },
        { local: [-0.24 * s, 1.12 * s, -0.06 * s], size: [0.08 * s, 0.34 * s, 0.08 * s], color: [0.09, 0.1, 0.11] },
      ];
    }
    case 'mailbox': {
      const s = def.heightMeters / 1.3;
      return [
        { local: [0, 0.475 * s, 0], size: [0.12 * s, 0.95 * s, 0.12 * s], color: [0.42, 0.35, 0.26] },
        { local: [0, 1.04 * s, 0], size: [0.42 * s, 0.36 * s, 0.44 * s], color: [0.61, 0.64, 0.69] },
        { local: [0.2 * s, 1.08 * s, 0.06 * s], size: [0.02 * s, 0.16 * s, 0.08 * s], color: [0.76, 0.23, 0.13] },
      ];
    }
    case 'fence': {
      const s = def.heightMeters / 1.2;
      const halfSpan = def.footprintRadiusMeters * 0.95;
      return [
        { local: [-halfSpan, def.heightMeters / 2, 0], size: [0.1 * s, def.heightMeters, 0.1 * s], color: [0.42, 0.45, 0.5] },
        { local: [halfSpan, def.heightMeters / 2, 0], size: [0.1 * s, def.heightMeters, 0.1 * s], color: [0.42, 0.45, 0.5] },
        { local: [0, def.heightMeters - 0.04 * s, 0], size: [halfSpan * 2, 0.05 * s, 0.05 * s], color: [0.61, 0.64, 0.69] },
        { local: [0, 0.06 * s, 0], size: [halfSpan * 2, 0.05 * s, 0.05 * s], color: [0.61, 0.64, 0.69] },
        { local: [0, (def.heightMeters - 0.14 * s) / 2 + 0.06 * s, 0], size: [halfSpan * 2, def.heightMeters - 0.14 * s, 0.02 * s], color: [0.69, 0.72, 0.77] },
      ];
    }
    default: {
      const box = PROP_BOX[prop.kind] ?? [def.footprintRadiusMeters * 2, def.heightMeters, def.footprintRadiusMeters * 2];
      return [{ local: [0, box[1] / 2, 0], size: box, color: propColor(prop.kind) }];
    }
  }
}

function pushPropGeometry(b: Build, prop: WorldProp): number {
  return pushPropParts(b, prop, propBoxParts(prop));
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
  const tcols = f.tileData[0] | 0;
  const trows = f.tileData[1] | 0;
  const palCount = f.tileData[2] | 0;
  const palBase = 3;
  const idxBase = 3 + palCount * 3;
  const out = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    const cy = Math.min(trows - 1, Math.max(0, Math.floor((y / height) * trows)));
    for (let x = 0; x < width; x += 1) {
      const cx = Math.min(tcols - 1, Math.max(0, Math.floor((x / width) * tcols)));
      const kind = f.tileData[idxBase + cy * tcols + cx] | 0;
      let r = 0.05;
      let g = 0.07;
      let b = 0.10;
      if (kind >= 0 && kind < palCount) {
        r = f.tileData[palBase + kind * 3 + 0] ?? r;
        g = f.tileData[palBase + kind * 3 + 1] ?? g;
        b = f.tileData[palBase + kind * 3 + 2] ?? b;
      }
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
    if (floorHasRelief(f)) continue;
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
  const fields = floors.filter(floorHasRelief);
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
  opts: { includeGroundLayers?: boolean } = {},
): WorldInstanceResult {
  const b = newBuild();
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

/** Encode the materials vocab lump — the SHIPPED RECIPES, not pixels:
 *  u32 count, then per material: u32 wgsl byte length | wgsl utf8 | u32 data
 *  float count | f32[data] | f32 opacity. The host runs each shader at load to a
 *  1-tile texture and samples it on the referencing faces; an empty wgsl with
 *  opacity<1 is a translucent flat material (glass) the host renders see-through. */
export function encodeMaterials(materials: readonly MaterialAsset[]): Uint8Array {
  // Bake breadcrumb (captured by the Compile button via 2>&1) so the user can SEE
  // what the data carries — separating "is glass in the gamefile" from "does the
  // loader render it". console.warn → stderr → the bake's merged output.
  const translucent = materials.filter((m) => m.opacity < 1).length;
  const shaders = materials.filter((m) => m.wgsl.length > 0).length;
  console.warn(`[materials] baked ${materials.length} material(s): ${shaders} shader, ${translucent} translucent`);
  // textBytes is the workspace's headless-safe utf8 encoder (the v8cli bake has
  // no TextEncoder; it falls back to encodeURIComponent). WGSL is ASCII anyway.
  const sources = materials.map((m) => textBytes(m.wgsl));
  let bytes = 4;
  for (let i = 0; i < materials.length; i += 1) {
    bytes += 4 + sources[i].byteLength + 4 + materials[i].data.length * 4 + 4;
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
