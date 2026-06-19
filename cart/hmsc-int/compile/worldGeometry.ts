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
import { propKindDefinition } from '../game/kinds/props';
import { solveRoadCrossSection } from '../world/roadProfile';
import { tileKindDefinition } from '../world/tileKinds';
import { CHUNK_TILES } from '../chunks';
import { WATER_LOOK, WATER_WAVE, waterFlatHeights } from '../game/kinds/waterBodies';
import { groundKindAt, HEIGHTFIELD_TILE_BODY, MARKER_KIND_INDICES, roadRibbonSection } from '../render3d/heightfieldSurface';
import { isParkingKind } from '../render3d/parkingStall';
import type { ChunkFloor } from '../chunkFloor';
import { floorToLandform } from '../chunkFloor';
import { buildGrassInstances, buildBushInstances } from '../render3d/grassPopulation';
import { GAME_BUILD } from '@game';
import type { BuildFaceSkin, BuildMaterial, PlacedBuildPiece } from '@game';
// THE ONE piece decomposition (PARITY-0611, req_0654/req_0655): the bake lowers
// the SAME pieceVisualShapes the editor and /test render — never a private
// re-derivation. compile/worldParity.test.ts holds the two views identical.
import { MATERIAL_LOOK, pieceVisualShapes, type VisualShape } from '../editors/build/pieceShapes';
import { shaderSpec, defaultShaderData } from '@game/textures/shaders';
import { loadCustomTextures, type CustomTexture } from '@game/textures/materials';
import { BUILTIN_DECALS } from '@game/textures/builtinDecals';
import { packDecalDoc } from './decalPack';
import type { DecalAssetSink } from './decalAssets';
import { createInteractableSink, type InteractableSink } from './worldInteractables';
import { createDynamicPropSink, type DynamicPropSink } from './worldDynamicProps';
import {
  box, cylinder8, cylinder16, sphere, propPartId,
  type Color, type Rotation, type PropPartShape, type PropPartSpec,
} from '../game/kinds/propModels';
// PROPSINGLE-0782: the ONE prop→parts resolver, shared with the /test render
// (render3d/props/DataProp) so a prop's geometry lives in exactly one place.
import { resolvePropParts } from './propRecipes/resolve';
import { importedPropMesh, isImportedPropKind, type ImportedPropMesh } from '../game/kinds/importedProps';
import { textBytes } from '@reactjit/workspace';

export const INSTANCE_STRIDE = 13;
export const INSTANCE_SHAPE_BOX = 0;
export const INSTANCE_SHAPE_RAMP = 1;
export const INSTANCE_SHAPE_CYLINDER8 = 2;
export const INSTANCE_SHAPE_CYLINDER16 = 3;
export const INSTANCE_SHAPE_SPHERE = 4;
// req_0930: a triangular prism — the GABLE END wall (a solid isoceles triangle
// extruded thin across the roof width). Keyed geometry in world_loader.zig
// (buildGablePrism); editor twin is pieceMeshes' GablePrismGeometry.
export const INSTANCE_SHAPE_GABLE = 5;
// Foliage card clumps — keyed geometry buildGrassBlade()/buildBushClump() in
// world_loader.zig, editor twins runtime/geometries/GrassBlade+BushClump. Their
// batch is routed to the foliage pipeline (wind + cutout + gradient) by the
// "~grass~" tex key the loader stamps; the row colour is the per-card root tint.
export const INSTANCE_SHAPE_GRASS = 6;
export const INSTANCE_SHAPE_BUSH = 7;

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

// Translucent looks (glass walls, window panes) arrive as VisualBox.opacity
// from the SHARED decomposition (MATERIAL_LOOK glass/chainlink alphas, window
// pane alpha) — no hand-mirrored alpha table here anymore.

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
const TEXTURED_ALPHA_PASS_OPACITY = 0.998;

function shaderMaterialOpacity(shaderId: string, data: readonly number[]): number {
  // Paint-bench cutouts are stencil textures: painted cells are opaque, the
  // background can be transparent. Mark them for the loader's transparent
  // textured path while keeping painted pixels visually opaque.
  if (shaderId === 'cutout-stencil' && (data[8] ?? 1) < 1) return TEXTURED_ALPHA_PASS_OPACITY;
  return 1;
}

function resolveMaterialShader(id: string): { wgsl: string; data: number[]; opacity: number } | null {
  const builtin = shaderSpec(id);
  if (builtin) {
    const data = defaultShaderData(builtin);
    return { wgsl: builtin.shader, data, opacity: shaderMaterialOpacity(builtin.id, data) };
  }
  const custom = customById(id);
  if (custom?.shaderId !== undefined && custom.data !== undefined) {
    const spec = shaderSpec(custom.shaderId);
    if (spec) return { wgsl: spec.shader, data: custom.data, opacity: shaderMaterialOpacity(custom.shaderId, custom.data) }; // frozen tuned data
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
  /** seat/container props recorded as they lower (PROPUSE req_0624) — the
   *  INTERACTABLES lump's source, collected in ONE place so every caller
   *  (build pieces and painted world layers alike) ships the capability */
  interact: InteractableSink;
  /** kickable props (KICKPROP req_0625) — dynamics kinds route their parts
   *  here as LOCAL rows instead of the static instance buffer; the loader
   *  steps them as sphere bodies and renders them as live nodes */
  dyn: DynamicPropSink;
  /** imported OBJ/GLB prop meshes — arbitrary baked vertices, referenced by
   *  thin placed-prop transforms in the MESH_PROPS lump. */
  meshProps: ImportedMeshPropSink;
};

function newBuild(assets?: DecalAssetSink): Build {
  return { inst: [], mats: [], vocab: [], index: new Map(), assets, interact: createInteractableSink(), dyn: createDynamicPropSink(), meshProps: createImportedMeshPropSink() };
}

export type ImportedMeshPropInstance = {
  mesh: number;
  x: number;
  y: number;
  z: number;
  yawDegrees: number;
};

export type ImportedMeshPropSink = {
  meshes: ImportedPropMesh[];
  instances: ImportedMeshPropInstance[];
};

function createImportedMeshPropSink(): ImportedMeshPropSink {
  return { meshes: [], instances: [] };
}

function collectImportedMeshProp(sink: ImportedMeshPropSink, prop: WorldProp, mesh: ImportedPropMesh): void {
  let slot = sink.meshes.findIndex((m) => m.key === mesh.key);
  if (slot < 0) {
    slot = sink.meshes.length;
    sink.meshes.push(mesh);
  }
  sink.instances.push({
    mesh: slot,
    x: prop.x,
    y: prop.y ?? 0,
    z: prop.z,
    yawDegrees: prop.yawDegrees ?? 0,
  });
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
    b.vocab.push({ key, wgsl: resolved.wgsl, data: resolved.data, opacity: resolved.opacity });
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

// Intern a TRANSLUCENT FLAT material — no shader, just an alpha; the row keeps
// its own color tint. The alpha comes from the shared decomposition's
// VisualBox.opacity (glass walls, window panes — whatever the editor draws
// see-through ships see-through).
function internTranslucent(b: Build, opacity: number): number {
  const key = `flat:a${opacity}`;
  const existing = b.index.get(key);
  if (existing !== undefined) return existing;
  const slot = b.vocab.length + 1;
  b.vocab.push({ key, wgsl: '', data: [], opacity });
  b.index.set(key, slot);
  return slot;
}

function overlayUnderlaySkins(skin: BuildFaceSkin | undefined, seen = new Set<string>()): BuildFaceSkin[] {
  if (!skin || skin.kind !== 'material' || seen.has(skin.id)) return [];
  seen.add(skin.id);
  const custom = customById(skin.id);
  if (custom?.shaderId !== 'cutout-stencil' || !custom.underlayId || custom.underlayId === skin.id) return [];
  const underlay: BuildFaceSkin = { kind: 'material', id: custom.underlayId };
  return [...overlayUnderlaySkins(underlay, seen), underlay];
}
// v3 (FORMULAFLOOR-0615): the painted ground ships the per-fragment ground FORMULA
// + each chunk's cell stream, NOT a baked 4px/tile raster. The compiled ground then
// renders through the same HEIGHTFIELD_TILE_BODY shader the editor /test view runs
// (constructor.zig decodes it, world_loader feeds gpu/3d.zig g_ground_pipeline) — crisp
// at any distance. v2 was the blurry baked-pixel path. Keep the writer + the v3 Zig
// decoder + worldGeometry.test.ts 'FORMULAFLOOR-0615' in lockstep.
const HEIGHTFIELD_LUMP_VERSION = 3;
const HEIGHTFIELD_RECORD_FLOATS = 10;
const DEG = Math.PI / 180;

// Color / Rotation / the prop part vocabulary live in game/kinds/propModels —
// the ONE module both renderers consume (PROPBATCH-0611).

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

// (stairs / elevator-storey / wall decompositions all flow from the SHARED
// pieceVisualShapes now — the dedicated pushStairs/pushElevatorStorey copies
// are gone; the parity suite caught the elevator copy already drifting.)

function hexColor(hex: string): Color {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16);
  return [((n >> 16) & 0xff) / 255, ((n >> 8) & 0xff) / 255, (n & 0xff) / 255];
}

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

function pushPropPart(b: Build, prop: WorldProp, part: PropPartSpec, index: number): void {
  const p = propAt(prop, part.local);
  // EVERY part is a texture target now (req_0757): the placed prop's
  // partTextures[id] is a TEXTURE_REGISTRY id whose shader/decal recipe interns
  // into the materials vocab — the SAME channel face skins ship through. The id
  // is propPartId(spec,index) — a panel's own partId, else its recipe index —
  // the SAME key /test's DataProp stores under, so the bake textures the mesh
  // the user clicked. Unresolvable ids (react-facade textures) keep flat color.
  const textureId = prop.partTextures?.[propPartId(part, index)];
  // A skin wins; else a glass part (opacity < 1) interns a translucent flat
  // material with that alpha — the SAME transparent path build-piece panes ride
  // (PROPGLASS-0773), so a display case's pane renders as real glass, not a
  // solid blue box, in both /test and the compiled game.
  const material = textureId
    ? internMaterial(b, { kind: 'material', id: textureId })
    : (part.opacity != null && part.opacity < 1 ? internTranslucent(b, part.opacity) : 0);
  pushShape(b, propShapeId(part.shape), p[0], p[1], p[2], propRotation(prop, part.rotation), part.size[0], part.size[1], part.size[2], part.color, material);
}

function pushPropParts(b: Build, prop: WorldProp, parts: readonly PropPartSpec[]): number {
  parts.forEach((part, index) => pushPropPart(b, prop, part, index));
  return parts.length;
}


function pushPropGeometry(b: Build, prop: WorldProp): number {
  b.interact.collect(prop);
  if (isImportedPropKind(prop.kind)) {
    const mesh = importedPropMesh(prop.kind);
    if (mesh) collectImportedMeshProp(b.meshProps, prop, mesh);
    return 0;
  }
  // A dynamics kind (ball/cone/can) is a BODY, not scenery: its parts ship in
  // the DYNAMIC_PROPS lump as LOCAL rows (anchor-relative, yaw un-folded — the
  // loader composes per frame like the player model) and stay OUT of the
  // one-time-uploaded static instance buffer. Mirrors /test's skipDynamicProps
  // + DynamicPropMeshes split (KICKPROP-0610).
  const dynamic = b.dyn.open(prop);
  if (dynamic) {
    for (const part of resolvePropParts(prop)) {
      dynamic.parts.push(
        part.local[0], part.local[1], part.local[2],
        part.rotation?.[0] ?? 0, part.rotation?.[1] ?? 0, part.rotation?.[2] ?? 0,
        part.size[0], part.size[1], part.size[2],
        part.color[0], part.color[1], part.color[2],
        propShapeId(part.shape),
      );
    }
    return 0;
  }
  return pushPropParts(b, prop, resolvePropParts(prop));
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
/** Parking cells (either orientation) need the textured bake — the white stall
 *  lines are fragment paint the flat box-slab path cannot draw (req_0699: the
 *  painter showed the lines, the compiled game showed plain dark cells). */
export function floorHasParkingCells(f: ChunkFloor): boolean {
  const tcols = f.tileData[0] | 0;
  const trows = f.tileData[1] | 0;
  const palCount = f.tileData[2] | 0;
  const idxBase = 3 + palCount * 3;
  for (let i = 0; i < tcols * trows; i += 1) {
    if (isParkingKind(f.tileData[idxBase + i] | 0)) return true;
  }
  return false;
}

export function floorNeedsHeightfieldRender(f: ChunkFloor): boolean {
  // FORMULAFLOOR-0615: EVERY painted chunk — flat, road, relief, or parking —
  // renders through the per-fragment ground formula, parity with the editor /test
  // view. So any chunk carrying paintable tiles takes the heightfield path and none
  // fall to the flat box-slab path (which can only flat-fill a cell with its colour).
  return floorHasPaintableTiles(f) || floorHasRelief(f) || floorHasRoadRibbon(f) || floorHasParkingCells(f);
}

/** A chunk has paintable ground when its tile map carries cols×rows cells over a
 *  non-empty palette (tileData = [cols, rows, palCount, …]). */
function floorHasPaintableTiles(f: ChunkFloor): boolean {
  return (f.tileData[0] | 0) > 0 && (f.tileData[1] | 0) > 0 && (f.tileData[2] | 0) > 0;
}

// Gameplay/dev marker indices in TILE_KINDS order — marker cells are META, not
// ground (req_0699); every compiled-floor path resolves them to the ground
// around them via groundKindAt (the textured bake already does, inside
// heightfieldTexelColor).
const MARKER_INDEX_SET: ReadonlySet<number> = new Set(MARKER_KIND_INDICES);

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
    if (v < 0 || v >= palCount || MARKER_INDEX_SET.has(v)) continue; // markers are meta, not ground
    r += f.tileData[palBase + v * 3 + 0];
    g += f.tileData[palBase + v * 3 + 1];
    b += f.tileData[palBase + v * 3 + 2];
    n += 1;
  }
  return n > 0 ? [r / n, g / n, b / n] : [0.45, 0.5, 0.42];
}

/** The per-chunk CELL STREAM the ground formula samples: [cols, rows, palCount,
 *  palette…, cell idx…, ribbon section]. Identical to the editor twin
 *  heightfieldTileData(tiles, roads) (render3d/heightfieldSurface) — f.tileData is
 *  already the [cols, rows, palCount, palette…, idx…] prefix, so we just append the
 *  road ribbon. Shipped raw (one f32 per entry) instead of baked to pixels, so the
 *  GPU evaluates HEIGHTFIELD_TILE_BODY per fragment = crisp at any zoom. */
function heightfieldGroundData(f: ChunkFloor): number[] {
  return [...f.tileData, ...roadRibbonSection(f.roads)];
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

// (Build-material colors come straight off the shared MATERIAL_LOOK table via
// pieceVisualShapes — the hand-mirrored MATERIAL_COLOR copy is gone.)

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

export const WATER_LUMP_VERSION = 1;

/** Bodies of water (world/water) → the WATER lump. Each body ships its FLAT
 *  surface-level height grid (waterFlatHeights — surfaceY inside the footprint,
 *  the basin floor outside so a disc rounds off); the loader renders it as a
 *  translucent heightfield (a wadeable volume via the skirt) and applies the
 *  travelling wave from its OWN clock — animated ripples in the shipped game with
 *  no per-frame data. The shared look (colour + alpha) and wave ride the header.
 *
 *  Layout: u32 version | u32 count |
 *          f32 colorR,colorG,colorB,alpha | f32 waveAmp,waveLen,waveSpeed,waveDirX,waveDirZ |
 *          per body: u32 cols,rows | f32 centerX,centerZ,base,width,depth | f32[cols*rows] heights */
export function encodeWaterBodies(bodies: GameState['world']['waterBodies'] | undefined): Uint8Array {
  const list = bodies ?? [];
  // A painted body (terrain water brush) ships its authored per-cell grid; a
  // parametric body builds a still grid from its footprint. The host applies the
  // wave either way.
  const grids = list.map((b) =>
    b.field
      ? { cols: b.field.cols, rows: b.field.rows, base: b.field.base, heights: b.field.heights }
      : waterFlatHeights(b.shape, b.width, b.depth, b.surfaceY));
  let bytes = 8 + 16 + 20;
  for (const g of grids) bytes += 8 + 20 + g.cols * g.rows * 4;
  const dv = new DataView(new ArrayBuffer(bytes));
  let o = 0;
  const u32 = (v: number) => { dv.setUint32(o, v >>> 0, true); o += 4; };
  const f32 = (v: number) => { dv.setFloat32(o, v, true); o += 4; };
  u32(WATER_LUMP_VERSION);
  u32(list.length);
  const c = hexColor(WATER_LOOK.color);
  f32(c[0]); f32(c[1]); f32(c[2]); f32(WATER_LOOK.opacity);
  f32(WATER_WAVE.amplitude); f32(WATER_WAVE.length); f32(WATER_WAVE.speed); f32(WATER_WAVE.dirX); f32(WATER_WAVE.dirZ);
  for (let k = 0; k < list.length; k += 1) {
    const b = list[k]!;
    const g = grids[k]!;
    u32(g.cols); u32(g.rows);
    f32(b.x + b.width / 2); f32(b.z + b.depth / 2); f32(g.base); f32(b.width); f32(b.depth);
    for (let m = 0; m < g.heights.length; m += 1) f32(g.heights[m]!);
  }
  return new Uint8Array(dv.buffer);
}

/** Lower ONE shared visual shape to an instance row. A box that wears a skin
 *  slot interns that skin's shader/decal exactly as /test textures it; a
 *  material-skinned face still ships its base-material color so a host
 *  without the materials vocab degrades to the base look, not invisible.
 *  Anything the editor draws translucent (glass, window panes) ships a flat
 *  translucent material with the same alpha. */
function pushVisualShape(b: Build, piece: PlacedBuildPiece, baseMaterial: BuildMaterial, shape: VisualShape): number {
  if (shape.kind === 'ramp') {
    // Match /test: ramps render as the real inclined slab geometry and
    // collide as a slope heightfield, not as a bounding box.
    const r = shape.ramp;
    pushRamp(b, r.x, r.y, r.z, r.width, r.height, r.depth, hexColor(r.color), r.yawDegrees);
    return 1;
  }
  // 'box' and 'gable' share the instance layout (pos+yaw+scale+skin); only the
  // keyed geometry differs (a unit cube vs the triangular gable-end prism).
  const v = shape.box;
  const shapeId = shape.kind === 'gable' ? INSTANCE_SHAPE_GABLE : INSTANCE_SHAPE_BOX;
  // DOORS-0611: the closed door/garage panel is LIVE state — it ships through
  // the DOORS lump (compile/worldDoors.ts) as a toggleable rect+node, never a
  // static row (a static panel could not open).
  if (v.door === true) return 0;
  const skin = v.slot !== undefined ? piece.skin?.[v.slot] : undefined;
  const underlaySkins = overlayUnderlaySkins(skin);
  let underlayRows = 0;
  let material = internMaterial(b, skin);
  const color = skin?.kind === 'material'
    ? hexColor(MATERIAL_LOOK[baseMaterial].color)
    : hexColor(v.color);
  for (const underlaySkin of underlaySkins) {
    const underlayMaterial = internMaterial(b, underlaySkin);
    if (underlayMaterial !== 0) {
      pushShape(b, shapeId, v.cx, v.cy, v.cz, [0, v.yawDegrees, 0], v.sx, v.sy, v.sz, color, underlayMaterial);
      underlayRows += 1;
    }
  }
  if (material === 0 && (v.opacity ?? 1) < 1) material = internTranslucent(b, v.opacity!);
  pushShape(b, shapeId, v.cx, v.cy, v.cz, [0, v.yawDegrees, 0], v.sx, v.sy, v.sz, color, material);
  return underlayRows + 1;
}

/** Extrude the BUILD stream's PLACED PIECES into box instances — the city's
 *  structures (walls/floors/pillars/towers/prefabs). Every non-prop piece
 *  lowers through the SHARED pieceVisualShapes decomposition (PARITY-0611) —
 *  door/window cutouts, corner miters, depth spans, stairs steps, the
 *  elevator's open-front frame all arrive exactly as the editor renders them
 *  (the old private wall/stairs/elevator copies shipped door walls SOLID,
 *  req_0654's hidden-wall doorway). */
function pushPlacedPieces(b: Build, pieces: readonly PlacedBuildPiece[]): number {
  let emitted = 0;
  for (const piece of pieces) {
    let def;
    try {
      def = GAME_BUILD.catalog.get(piece.pieceId);
    } catch {
      continue; // unknown piece id — skip rather than abort the whole bake
    }
    if (def.kind === 'prop' && def.propKind) {
      emitted += pushPropGeometry(b, {
        id: piece.id,
        kind: def.propKind as WorldProp['kind'],
        x: piece.x,
        y: piece.y,
        z: piece.z,
        yawDegrees: piece.yawDegrees,
        // PROPSKIN-0766: bake the placed prop's per-part textures (the same
        // partTextures channel /test renders) so the compiled prop wears them.
        partTextures: piece.partTextures,
        // PARAMETRIC props (req_0893): bake THIS placement's text so the compiled
        // sign lowers the same word the editor showed.
        text: piece.text,
        createdByCommand: 'hmsc-int:compile-build-prop',
      });
      continue;
    }
    for (const shape of pieceVisualShapes(piece, piece.id, pieces)) {
      emitted += pushVisualShape(b, piece, def.material, shape);
    }
  }
  // The elevator CAR is deliberately NOT a static instance row (REQ-0652):
  // the ELEVATORS lump ships the shafts and the loader renders one LIVE car
  // node per shaft (the dynamic-prop pattern) — a moving car never re-stages
  // the world buffer. The shaft frames above stay static.
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
        // Marker cells (spawn/save/vehicleSpawn/dev) resolve to the ground
        // around them — meta never paints the game floor (req_0699).
        const v = groundKindAt(f.tileData, idxBase, tcols, trows, i, j);
        if (v < 0) { i += 1; continue; } // empty cell — void shows through
        let i1 = i + 1;
        while (i1 < tcols && groundKindAt(f.tileData, idxBase, tcols, trows, i1, j) === v) i1 += 1;
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

/** Per painted chunk, the height grid the formula mesh displaces. A relief chunk
 *  ships its real hcols×hrows samples; a FLAT chunk ships a cheap 2×2 of zeros (the
 *  Zig decoder requires cols,rows ≥ 2). Either way the look comes from the cell
 *  stream the formula samples, not the mesh resolution. */
function heightfieldGrid(f: ChunkFloor): { cols: number; rows: number; height: (i: number) => number } {
  const hcols = f.hcols | 0;
  const hrows = f.hrows | 0;
  const hasRelief = hcols >= 2 && hrows >= 2 && f.heights.length >= hcols * hrows;
  if (hasRelief) return { cols: hcols, rows: hrows, height: (i) => f.heights[i] ?? 0 };
  return { cols: 2, rows: 2, height: () => 0 };
}

// FORMULAFLOOR-0615 v3 lump layout (decoded by framework/world/constructor.zig
// decodeHeightfields, asserted by worldGeometry.test.ts):
//   u32 version=3 | u32 fieldCount
//   u32 formulaLen | formula utf8           ← the ground formula, shipped ONCE
//   per field: u32 cols | u32 rows | u32 groundDataLen | u32 0
//              f32 record[HEIGHTFIELD_RECORD_FLOATS]
//              f32 heights[cols*rows]
//              f32 groundData[groundDataLen]
export function encodeFloorHeightfields(floors: readonly ChunkFloor[]): Uint8Array {
  const fields = floors.filter(floorNeedsHeightfieldRender);
  // textBytes is the workspace's headless-safe utf8 encoder (the v8cli bake has no
  // TextEncoder). HEIGHTFIELD_TILE_BODY is ASCII WGSL, so it round-trips cleanly.
  const formula = textBytes(HEIGHTFIELD_TILE_BODY);

  const grids = fields.map(heightfieldGrid);
  const groundDatas = fields.map(heightfieldGroundData);
  let bytes = 8 + 4 + formula.byteLength; // header + formula (len + bytes), once
  for (let fi = 0; fi < fields.length; fi += 1) {
    bytes += 16 + HEIGHTFIELD_RECORD_FLOATS * 4 + grids[fi].cols * grids[fi].rows * 4 + groundDatas[fi].length * 4;
  }

  const out = new Uint8Array(bytes);
  const view = new DataView(out.buffer);
  view.setUint32(0, HEIGHTFIELD_LUMP_VERSION, true);
  view.setUint32(4, fields.length, true);
  view.setUint32(8, formula.byteLength, true);
  out.set(formula, 12);
  let at = 12 + formula.byteLength;
  for (let fi = 0; fi < fields.length; fi += 1) {
    const f = fields[fi];
    const { cols, rows, height } = grids[fi];
    const groundData = groundDatas[fi];
    const cell = cols > 1 ? CHUNK_TILES / (cols - 1) : CHUNK_TILES;
    const color = floorSurfaceColor(f);
    view.setUint32(at + 0, cols, true);
    view.setUint32(at + 4, rows, true);
    view.setUint32(at + 8, groundData.length, true); // slot A = groundDataLen (v3)
    view.setUint32(at + 12, 0, true); // slot B reserved
    at += 16;
    const floats = [
      f.cx * CHUNK_TILES + CHUNK_TILES / 2,
      f.cz * CHUNK_TILES + CHUNK_TILES / 2,
      0,
      CHUNK_TILES,
      CHUNK_TILES,
      cell,
      Math.cos((38 * Math.PI) / 180),
      color[0],
      color[1],
      color[2],
    ];
    for (let i = 0; i < floats.length; i += 1) view.setFloat32(at + i * 4, floats[i], true);
    at += HEIGHTFIELD_RECORD_FLOATS * 4;
    for (let i = 0; i < cols * rows; i += 1) view.setFloat32(at + i * 4, height(i), true);
    at += cols * rows * 4;
    for (let i = 0; i < groundData.length; i += 1) view.setFloat32(at + i * 4, groundData[i], true);
    at += groundData.length * 4;
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
  /** Seat/container props (archetypes + instance refs) for the INTERACTABLES
   *  lump — the compiled game's E-to-sit/search capability (req_0624). */
  interactables: Pick<InteractableSink, 'archetypes' | 'instances'>;
  /** Kickable props (body recipe + local render parts) for the DYNAMIC_PROPS
   *  lump — the compiled game's roll/kick dynamics (req_0625). */
  dynamicProps: DynamicPropSink['props'];
  /** OBJ/GLB-imported static prop meshes. */
  meshProps: ImportedMeshPropSink;
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
/** Populate a foliage card field (grass blades / bush clumps) over its painted
 *  tiles into the given shapeId. ALWAYS emitted (deliberate authored content) —
 *  reuses the editor's populate fn so the field is identical in /test and /compiled.
 *  Cards carry NO material; the loader routes the batch to the foliage pipeline via
 *  the "~grass~" tex key. The painter writes foliage tiles into painted FLOOR chunks,
 *  so the bake gets them as `floors`; convert each to its landform twin so the
 *  populate fn reads the same tile grids the editor does — identical field. */
function pushFoliage(
  b: Build,
  state: GameState,
  floors: readonly ChunkFloor[],
  build: (world: GameState['world']) => { data: Float32Array; count: number },
  shapeId: number,
  label: string,
): void {
  const floorLandforms = floors.map(floorToLandform);
  const world = floorLandforms.length
    ? { ...state.world, landforms: [...(state.world.landforms ?? []), ...floorLandforms] }
    : state.world;
  const field = build(world as GameState['world']); // stride-12: pos3 rot3 scale3 color3
  const d = field.data;
  // console.warn → stderr (NEVER print/console.log — stdout carries the bake's
  // JSON result the CLI parses; writing there corrupts it).
  console.warn(`[bake] ${label}: ${field.count} card(s) over painted tiles`);
  for (let i = 0; i < field.count; i += 1) {
    const o = i * 12;
    pushShape(
      b,
      shapeId,
      d[o + 0], d[o + 1], d[o + 2],
      [d[o + 3], d[o + 4], d[o + 5]],
      d[o + 6], d[o + 7], d[o + 8],
      [d[o + 9], d[o + 10], d[o + 11]],
    );
  }
}

export function buildWorldInstances(
  state: GameState,
  pieces: readonly PlacedBuildPiece[] = [],
  floors: readonly ChunkFloor[] = [],
  opts: { includeGroundLayers?: boolean; decalAssets?: DecalAssetSink } = {},
): WorldInstanceResult {
  customByIdCache = null;
  const b = newBuild(opts.decalAssets);
  const pieceCount = pushPlacedPieces(b, pieces);
  pushPaintedFloors(b, floors);
  if (opts.includeGroundLayers) pushWorldLayers(b, state);
  pushFoliage(b, state, floors, buildGrassInstances, INSTANCE_SHAPE_GRASS, 'grass');
  pushFoliage(b, state, floors, buildBushInstances, INSTANCE_SHAPE_BUSH, 'bush');
  // Bodies of water ship in their own WATER lump (encodeWaterBodies) as animated
  // translucent heightfields, not instances — so they're NOT pushed here.
  return {
    instances: new Float32Array(b.inst),
    total: Math.floor(b.inst.length / INSTANCE_STRIDE),
    pieces: pieceCount,
    materialRefs: Uint32Array.from(b.mats),
    materials: b.vocab,
    interactables: { archetypes: b.interact.archetypes, instances: b.interact.instances },
    dynamicProps: b.dyn.props,
    meshProps: b.meshProps,
  };
}

export const MESH_PROPS_LUMP_VERSION = 2;

/** Encode imported OBJ/GLB prop meshes:
 *  u32 version | u32 meshCount | u32 instanceCount
 *  mesh[]: u32 keyLen | utf8 key | f32 color3 | f32 bounds |
 *          f32 footprintWidth | f32 footprintDepth | f32 height |
 *          u32 solid | u32 vertexCount | f32[vertexCount*8]
 *  instance[]: u32 meshIndex | f32 x,y,z,yawDegrees
 */
export function encodeMeshProps(sink: ImportedMeshPropSink): Uint8Array {
  let bytes = 12;
  const keyBytes = sink.meshes.map((mesh) => textBytes(mesh.key));
  for (let i = 0; i < sink.meshes.length; i += 1) {
    const mesh = sink.meshes[i]!;
    bytes += 4 + keyBytes[i]!.byteLength + 36 + mesh.vertices.byteLength;
  }
  bytes += sink.instances.length * 20;
  const out = new Uint8Array(bytes);
  const view = new DataView(out.buffer);
  view.setUint32(0, MESH_PROPS_LUMP_VERSION, true);
  view.setUint32(4, sink.meshes.length, true);
  view.setUint32(8, sink.instances.length, true);
  let at = 12;
  for (let i = 0; i < sink.meshes.length; i += 1) {
    const mesh = sink.meshes[i]!;
    const key = keyBytes[i]!;
    view.setUint32(at, key.byteLength, true); at += 4;
    out.set(key, at); at += key.byteLength;
    view.setFloat32(at + 0, mesh.color[0], true);
    view.setFloat32(at + 4, mesh.color[1], true);
    view.setFloat32(at + 8, mesh.color[2], true);
    view.setFloat32(at + 12, mesh.boundsRadius, true);
    view.setFloat32(at + 16, mesh.footprintWidthMeters, true);
    view.setFloat32(at + 20, mesh.footprintDepthMeters, true);
    view.setFloat32(at + 24, mesh.heightMeters, true);
    view.setUint32(at + 28, mesh.solid ? 1 : 0, true);
    view.setUint32(at + 32, mesh.count, true);
    at += 36;
    out.set(new Uint8Array(mesh.vertices.buffer, mesh.vertices.byteOffset, mesh.vertices.byteLength), at);
    at += mesh.vertices.byteLength;
  }
  for (const inst of sink.instances) {
    view.setUint32(at + 0, inst.mesh, true);
    view.setFloat32(at + 4, inst.x, true);
    view.setFloat32(at + 8, inst.y, true);
    view.setFloat32(at + 12, inst.z, true);
    view.setFloat32(at + 16, inst.yawDegrees, true);
    at += 20;
  }
  return out;
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
