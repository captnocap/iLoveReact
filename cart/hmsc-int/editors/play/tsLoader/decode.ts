// decode.ts — the TypeScript twin of framework/world/constructor.zig's load path.
//
// world_loader.zig (the no-V8 native loader behind /compiled) is fast because it
// LOADS FLAT BAKED DATA: it reads the RJMP map container, decodes each lump into a
// plain struct, and uploads one packed instance buffer — no live derivation. The
// editor's /test route instead re-derives all its geometry/colliders from the
// GameState every render. This module clones the loader's *load path* in TS so
// /test can consume the SAME baked container (createHmscMapfile output) and we can
// measure whether loading-flat-data is as cheap in V8 as it is native.
//
// Every decoder here mirrors its TS ENCODER twin byte-for-byte (the encoders are
// the authoritative wire contract, all under cart/hmsc-int/compile/ + runtime/
// workspace/). The Zig decoders in constructor.zig are the third copy of the same
// format; worldParity keeps them in lockstep. When an encoder layout changes, the
// matching decoder here changes with it.

import { bytesText, findLump, MAP_LUMP, readLumpContainer, type LumpRecord } from '@reactjit/workspace';
import { INSTANCE_STRIDE, MATERIALS_DOC_TAIL_MAGIC } from '../../../compile/worldGeometry';
import type { Heightfield } from '@game';

// ── decoded shapes (the JS analogue of constructor.zig's Scene) ──────────────

/** A face material shipped as its RECIPE (GUIDING_LIGHT): a WGSL shader source +
 *  its data[] params, OR a packed DecalDoc the host rasterizes. opacity<1 with an
 *  empty shader is a translucent flat material (glass). */
export interface LoadedMaterial {
  wgsl: string;
  data: Float32Array;
  opacity: number;
  /** Packed DecalDoc bytes (DECALRECIPE-0610), present only for decal materials. */
  doc: Uint8Array | null;
}

/** The render environment (lighting / sky / camera framing) — data, not hardcoded. */
export interface LoadedEnvironment {
  ambientColor: [number, number, number];
  ambientIntensity: number;
  dir: [number, number, number];
  dirColor: [number, number, number];
  dirIntensity: number;
  skyZenith: [number, number, number];
  skyHorizon: [number, number, number];
  skyGround: [number, number, number];
  skySunDir: [number, number, number];
  skySunColor: [number, number, number];
  skyHaze: number;
  skyCloud: number;
  skyNight: number;
  camFov: number;
  camHorizFactor: number;
  camHorizBase: number;
  camHeightFactor: number;
  camHeightBase: number;
  camFarFactor: number;
}

/** The AUTHORED physics solids — the SAME +-join-aware bands the editor steps
 *  against, flat per the host wire order. `rects`/`oriented` are flat float runs
 *  (RECT_FLOATS / ORIENTED_FLOATS per record); `ramps` are decoded heightfields. */
export interface LoadedColliders {
  rects: Float32Array; // 9 floats per rect: minX,minZ,maxX,maxZ,top,solid,friction,restitution,floor
  oriented: Float32Array; // the 9 + pivotX,pivotZ,yawRad
  ramps: Heightfield[];
}

export interface LoadedPhysicsConfig {
  gravity: number;
  jumpSpeed: number;
  playerRadius: number;
  playerHeight: number;
  stepHeight: number;
  wallRestitution: number;
  bodyRestitution: number;
  walkableSidePushGrace: number;
  accelerationMultiplier: number;
  surfaceFriction: number;
  surfaceRestitution: number;
  walkSpeed: number;
  runSpeed: number;
}

/** One painted-foliage cell the loader expands into blades (FOLIAGEFORMULA). */
export interface LoadedFloraCell {
  cellKey: number;
  wx: number;
  wz: number;
  top: number;
  specId: number; // 0 = grass, 1 = bush
  count: number;
}

export interface LoadedFlora {
  cellSizeMeters: number;
  cells: LoadedFloraCell[];
}

/** The composed, renderable world — the load-path output. Mirrors the subset of
 *  constructor.zig's Scene this loader renders; absent lumps decode to empty. */
export interface LoadedScene {
  /** Packed instance buffer: `stride` floats per row (12 = pos3/rot3/scale3/rgb,
   *  +1 shapeId at stride 13). The first `pieceCount` rows are the placed
   *  structures (the city), the rest the painted ground / foliage. */
  instances: Float32Array;
  instanceCount: number;
  instanceStride: number;
  pieceCount: number;
  materials: LoadedMaterial[];
  /** Per-row material slot, 1-based into `materials` (0 = flat color). Parallel to
   *  the instance rows; empty when the lump is absent. */
  materialRefs: Uint32Array;
  heightfields: Heightfield[];
  colliders: LoadedColliders | null;
  physicsConfig: LoadedPhysicsConfig | null;
  flora: LoadedFlora | null;
  environment: LoadedEnvironment | null;
}

// ── lump decoders (each the inverse of its compile/ encoder) ─────────────────

function dvOf(bytes: Uint8Array): DataView {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

/** INSTANCES: u32 count | u32 stride | u32 pieceCount | f32[count*stride].
 *  Inverse of worldGeometry.ts encodeInstanceLump. */
function decodeInstances(bytes: Uint8Array): { instances: Float32Array; count: number; stride: number; pieces: number } {
  if (bytes.byteLength < 12) return { instances: new Float32Array(0), count: 0, stride: INSTANCE_STRIDE, pieces: 0 };
  const view = dvOf(bytes);
  const count = view.getUint32(0, true);
  const stride = view.getUint32(4, true) || INSTANCE_STRIDE;
  const pieces = view.getUint32(8, true);
  const floats = count * stride;
  const instances = new Float32Array(floats);
  for (let i = 0; i < floats; i += 1) instances[i] = view.getFloat32(12 + i * 4, true);
  return { instances, count, stride, pieces };
}

/** MATERIAL_REFS: u32 count | u32[count]. Inverse of encodeMaterialRefs. */
function decodeMaterialRefs(bytes: Uint8Array): Uint32Array {
  if (bytes.byteLength < 4) return new Uint32Array(0);
  const view = dvOf(bytes);
  const count = view.getUint32(0, true);
  const refs = new Uint32Array(count);
  for (let i = 0; i < count; i += 1) refs[i] = view.getUint32(4 + i * 4, true);
  return refs;
}

/** MATERIALS: u32 count | per material: u32 wgslLen | wgsl | u32 dataLen | f32[]
 *  | f32 opacity | optional DOCS tail (u32 magic | u32 entryCount | per:
 *  u32 materialIndex | u32 docLen | doc). Inverse of encodeMaterials. */
function decodeMaterials(bytes: Uint8Array): LoadedMaterial[] {
  if (bytes.byteLength < 4) return [];
  const view = dvOf(bytes);
  const count = view.getUint32(0, true);
  const materials: LoadedMaterial[] = [];
  let at = 4;
  for (let i = 0; i < count; i += 1) {
    const wgslLen = view.getUint32(at, true); at += 4;
    const wgsl = wgslLen > 0 ? bytesText(bytes.subarray(at, at + wgslLen)) : '';
    at += wgslLen;
    const dataLen = view.getUint32(at, true); at += 4;
    const data = new Float32Array(dataLen);
    for (let k = 0; k < dataLen; k += 1) { data[k] = view.getFloat32(at, true); at += 4; }
    const opacity = view.getFloat32(at, true); at += 4;
    materials.push({ wgsl, data, opacity, doc: null });
  }
  // Optional decal-doc tail: attach each packed doc to its material by index.
  if (at + 8 <= bytes.byteLength && view.getUint32(at, true) === MATERIALS_DOC_TAIL_MAGIC) {
    at += 4;
    const entryCount = view.getUint32(at, true); at += 4;
    for (let e = 0; e < entryCount; e += 1) {
      const materialIndex = view.getUint32(at, true); at += 4;
      const docLen = view.getUint32(at, true); at += 4;
      const doc = bytes.slice(at, at + docLen); at += docLen;
      const mat = materials[materialIndex];
      if (mat) mat.doc = doc;
    }
  }
  return materials;
}

/** COLLIDERS: u32 version | u32 rectCount | f32[rectCount*9] | u32 orientedCount |
 *  f32[orientedCount*12] | u32 rampCount | per ramp: f32 originX,originZ,cellSize |
 *  u32 cols,rows | f32 baseY,walkCos,yawRad,pivotX,pivotZ | f32[cols*rows].
 *  Inverse of worldColliders.ts encodeCollidersLump. */
const RECT_FLOATS = 9;
const ORIENTED_FLOATS = 12;
function decodeColliders(bytes: Uint8Array): LoadedColliders {
  const view = dvOf(bytes);
  let at = 0;
  /* version */ at += 4;
  const rectCount = view.getUint32(at, true); at += 4;
  const rects = new Float32Array(rectCount * RECT_FLOATS);
  for (let i = 0; i < rects.length; i += 1) { rects[i] = view.getFloat32(at, true); at += 4; }
  const orientedCount = view.getUint32(at, true); at += 4;
  const oriented = new Float32Array(orientedCount * ORIENTED_FLOATS);
  for (let i = 0; i < oriented.length; i += 1) { oriented[i] = view.getFloat32(at, true); at += 4; }
  const rampCount = view.getUint32(at, true); at += 4;
  const ramps: Heightfield[] = [];
  for (let r = 0; r < rampCount; r += 1) {
    const originX = view.getFloat32(at, true); at += 4;
    const originZ = view.getFloat32(at, true); at += 4;
    const cellSizeMeters = view.getFloat32(at, true); at += 4;
    const cols = view.getUint32(at, true); at += 4;
    const rows = view.getUint32(at, true); at += 4;
    const baseY = view.getFloat32(at, true); at += 4;
    const walkableSlopeCos = view.getFloat32(at, true); at += 4;
    const yawRadians = view.getFloat32(at, true); at += 4;
    const pivotX = view.getFloat32(at, true); at += 4;
    const pivotZ = view.getFloat32(at, true); at += 4;
    const heights = new Float32Array(cols * rows);
    for (let i = 0; i < heights.length; i += 1) { heights[i] = view.getFloat32(at, true); at += 4; }
    ramps.push({ slot: r, originX, originZ, cellSizeMeters, cols, rows, baseY, walkableSlopeCos, heights, yawRadians, pivotX, pivotZ });
  }
  return { rects, oriented, ramps };
}

/** PHYSICS_CONFIG: u32 version | f32[13]. Inverse of encodePhysicsConfigLump. */
function decodePhysicsConfig(bytes: Uint8Array): LoadedPhysicsConfig | null {
  if (bytes.byteLength < 4 + 13 * 4) return null;
  const view = dvOf(bytes);
  const f = (i: number) => view.getFloat32(4 + i * 4, true);
  return {
    gravity: f(0),
    jumpSpeed: f(1),
    playerRadius: f(2),
    playerHeight: f(3),
    stepHeight: f(4),
    wallRestitution: f(5),
    bodyRestitution: f(6),
    walkableSidePushGrace: f(7),
    accelerationMultiplier: f(8),
    surfaceFriction: f(9),
    surfaceRestitution: f(10),
    walkSpeed: f(11),
    runSpeed: f(12),
  };
}

/** HEIGHTFIELDS (v3): u32 version | u32 fieldCount | u32 formulaLen | formula |
 *  per field: u32 cols | u32 rows | u32 groundDataLen | u32 reserved |
 *  f32[10] record (centerX,centerZ,baseY,width,depth,cell,walkCos,r,g,b) |
 *  f32[cols*rows] heights | f32[groundDataLen] groundData.
 *  Inverse of worldGeometry.ts encodeFloorHeightfields. We keep the height grid +
 *  placement for collision/render; groundData (the shader formula inputs) is read
 *  past but not retained (the editor render derives its own ground look). */
const HEIGHTFIELD_RECORD_FLOATS = 10;
function decodeHeightfields(bytes: Uint8Array): Heightfield[] {
  if (bytes.byteLength < 12) return [];
  const view = dvOf(bytes);
  const fieldCount = view.getUint32(4, true);
  const formulaLen = view.getUint32(8, true);
  let at = 12 + formulaLen;
  const fields: Heightfield[] = [];
  const WALKABLE_SLOPE_COS = Math.cos((38 * Math.PI) / 180);
  for (let fi = 0; fi < fieldCount; fi += 1) {
    const cols = view.getUint32(at, true); at += 4;
    const rows = view.getUint32(at, true); at += 4;
    const groundDataLen = view.getUint32(at, true); at += 4;
    /* reserved */ at += 4;
    const rec: number[] = [];
    for (let i = 0; i < HEIGHTFIELD_RECORD_FLOATS; i += 1) { rec.push(view.getFloat32(at, true)); at += 4; }
    const [centerX, centerZ, , width, depth, cell] = rec;
    const heights = new Float32Array(cols * rows);
    for (let i = 0; i < heights.length; i += 1) { heights[i] = view.getFloat32(at, true); at += 4; }
    at += groundDataLen * 4; // groundData: read past
    fields.push({
      slot: fi,
      // The record stores the field CENTER + extents; collision/render want the
      // min corner as origin (the chunk's lower-left), matching ChunkFloor fields.
      originX: centerX - width / 2,
      originZ: centerZ - depth / 2,
      cellSizeMeters: cell,
      cols,
      rows,
      baseY: 0,
      walkableSlopeCos: WALKABLE_SLOPE_COS,
      heights,
      yawRadians: 0,
      pivotX: centerX - width / 2,
      pivotZ: centerZ - depth / 2,
    });
  }
  return fields;
}

/** FLORA (v1): u32 version | f32 cellSize | u32 cellCount | per cell: u32 cellKey |
 *  f32 wx | f32 wz | f32 top | u16 specId | u16 count. Inverse of encodeFlora. */
function decodeFlora(bytes: Uint8Array): LoadedFlora | null {
  if (bytes.byteLength < 12) return null;
  const view = dvOf(bytes);
  const cellSizeMeters = view.getFloat32(4, true);
  const cellCount = view.getUint32(8, true);
  const cells: LoadedFloraCell[] = [];
  let at = 12;
  for (let i = 0; i < cellCount; i += 1) {
    const cellKey = view.getUint32(at, true); at += 4;
    const wx = view.getFloat32(at, true); at += 4;
    const wz = view.getFloat32(at, true); at += 4;
    const top = view.getFloat32(at, true); at += 4;
    const specId = view.getUint16(at, true); at += 2;
    const count = view.getUint16(at, true); at += 2;
    cells.push({ cellKey, wx, wz, top, specId, count });
  }
  return { cellSizeMeters, cells };
}

/** ENVIRONMENT: u32 version(1) | f32[35]. Inverse of sceneEnv.ts encodeEnvironmentLump. */
const SCENE_ENV_VERSION = 1;
const SCENE_ENV_FLOATS = 35;
function decodeEnvironment(bytes: Uint8Array): LoadedEnvironment | null {
  if (bytes.byteLength < 4 + SCENE_ENV_FLOATS * 4) return null;
  const view = dvOf(bytes);
  if (view.getUint32(0, true) !== SCENE_ENV_VERSION) return null;
  const f: number[] = [];
  for (let i = 0; i < SCENE_ENV_FLOATS; i += 1) f.push(view.getFloat32(4 + i * 4, true));
  return {
    ambientColor: [f[0], f[1], f[2]],
    ambientIntensity: f[3],
    dir: [f[4], f[5], f[6]],
    dirColor: [f[7], f[8], f[9]],
    dirIntensity: f[10],
    skyZenith: [f[11], f[12], f[13]],
    skyHorizon: [f[14], f[15], f[16]],
    skyGround: [f[17], f[18], f[19]],
    skySunDir: [f[20], f[21], f[22]],
    skySunColor: [f[23], f[24], f[25]],
    skyHaze: f[26],
    skyCloud: f[27],
    skyNight: f[28],
    camFov: f[29],
    camHorizFactor: f[30],
    camHorizBase: f[31],
    camHeightFactor: f[32],
    camHeightBase: f[33],
    camFarFactor: f[34],
  };
}

// ── the load entry (the twin of constructor.construct, container level) ──────

/** Decode an RJMP map container (createHmscMapfile output) into a LoadedScene.
 *  This is the load path /test runs in place of live GameState derivation: read
 *  the directory, decode each known lump, return flat ready-to-render data. The
 *  full game-file wrapper (GAME_LUMP streams + content-addressed assets) is only
 *  needed for the player/decal asset vocabulary; the world geometry, materials,
 *  colliders, terrain and foliage all live in the map container decoded here. */
export function loadSceneFromMapContainer(bytes: Uint8Array): LoadedScene {
  const records = readLumpContainer(bytes, { knownTypes: new Set(Object.values(MAP_LUMP)) });
  const lump = (type: number): LumpRecord | null => findLump(records, type);

  const inst = lump(MAP_LUMP.INSTANCES);
  const decodedInst = inst
    ? decodeInstances(inst.data)
    : { instances: new Float32Array(0), count: 0, stride: INSTANCE_STRIDE, pieces: 0 };

  const materialsLump = lump(MAP_LUMP.MATERIALS);
  const materialRefsLump = lump(MAP_LUMP.MATERIAL_REFS);
  const collidersLump = lump(MAP_LUMP.COLLIDERS);
  const physicsLump = lump(MAP_LUMP.PHYSICS_CONFIG);
  const heightfieldsLump = lump(MAP_LUMP.HEIGHTFIELDS);
  const floraLump = lump(MAP_LUMP.FLORA);
  const envLump = lump(MAP_LUMP.ENVIRONMENT);

  return {
    instances: decodedInst.instances,
    instanceCount: decodedInst.count,
    instanceStride: decodedInst.stride,
    pieceCount: decodedInst.pieces,
    materials: materialsLump ? decodeMaterials(materialsLump.data) : [],
    materialRefs: materialRefsLump ? decodeMaterialRefs(materialRefsLump.data) : new Uint32Array(0),
    heightfields: heightfieldsLump ? decodeHeightfields(heightfieldsLump.data) : [],
    colliders: collidersLump ? decodeColliders(collidersLump.data) : null,
    physicsConfig: physicsLump ? decodePhysicsConfig(physicsLump.data) : null,
    flora: floraLump ? decodeFlora(floraLump.data) : null,
    environment: envLump ? decodeEnvironment(envLump.data) : null,
  };
}
