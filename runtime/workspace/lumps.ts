// lumps.ts — platform mapfile container + binary row-RLE transcode.
//
// The format is intentionally BSP-like: a small fixed header, a fixed-width
// directory, and aligned lump payloads. Readers can filter to the lump types
// they understand; unknown entries remain in the directory but are skipped by
// typed callers.

import type { RleGrid } from './rle';
import { decodeGrid, encodeGrid } from './rle';

export const LUMP_MAGIC = 0x504d4a52; // "RJMP", little-endian
export const LUMP_FORMAT_VERSION = 0;
export const LUMP_ALIGNMENT = 16;
export const LUMP_HEADER_BYTES = 16;
export const LUMP_DIRECTORY_ENTRY_BYTES = 24;

export const LUMP_ENCODING = {
  raw: 0,
  rle8: 1,
  rle16: 2,
  text: 3,
} as const;

export type LumpEncoding = keyof typeof LUMP_ENCODING;

export const MAP_LUMP = {
  STRINGS: 1,
  TILES: 2,
  HEIGHTS: 3,
  ZONES: 4,
  PLACEMENTS: 5,
  ENTITIES: 6,
  // Packed 3D instance buffer (u32 count | f32[count*9], stride = pos3/scale3/
  // color3). The authored world's geometry lowered to data the no-V8 loader
  // renders as one instanced unit-cube batch. See compile/worldGeometry.ts.
  INSTANCES: 7,
  // Scene render environment (lighting / sky / camera framing) as data — the
  // loader reads it instead of hardcoding the look. See compile/sceneEnv.ts.
  ENVIRONMENT: 8,
  // Baked runtime player model: local-coordinate colored mesh groups generated
  // from the V2 figure kit. The loader instantiates these groups at the live
  // player transform; no JS figure evaluation runs in the shipped path.
  PLAYER_MODEL: 9,
  // Baked runtime animation clips for the player model. The payload is
  // content-addressed and contains declarative transform keyframes only; the
  // loader just interpolates them.
  PLAYER_ANIMATION: 10,
  // Baked regular-grid terrain heightfields. Each field is a cols×rows height
  // grid plus placement/material metadata; the loader hands it to the native
  // Scene3D heightfield primitive so gpu/3d.zig owns the triangulation.
  HEIGHTFIELDS: 11,
  // Material vocab: the looks that skin faces, shipped as RECIPES and run by
  // the host once at load — SHADERS as WGSL + data[] params, DECALS as their
  // packed DecalDoc (an optional 'DOCS' tail of this lump; the loader
  // rasterizes it — DECALRECIPE-0610). See compile/worldGeometry.ts
  // (encodeMaterials) + compile/decalPack.ts. GUIDING_LIGHT: store the
  // recipe, never the rendered product.
  MATERIALS: 12,
  // Per-instance-row material reference (u32 count | u32[count]); 1-based index
  // into MATERIALS, 0 = flat color. Parallel to INSTANCES rows — the loader
  // reads them in lockstep and renders material rows as textured faces.
  MATERIAL_REFS: 13,
  // Authored physics colliders — the SAME semantic solids the editor's play
  // view steps against (placedPieceColliders / placedPieceRamps), NOT a guess
  // re-derived from the render boxes. Carries the wall-join, door-opening,
  // half-height and ramp-trim meaning, so a "+" wall collides exactly where it
  // looks. Layout: u32 version | u32 rectCount | f32[rectCount*9] (host wire
  // order: minX,minZ,maxX,maxZ,top,solid,friction,restitution,floor) |
  // u32 orientedCount | f32[orientedCount*12] (the 9 + pivotX,pivotZ,yawRad) |
  // u32 rampCount | per ramp: f32 originX,originZ,cellSize | u32 cols,rows |
  // f32 baseY,walkCos,yawRad,pivotX,pivotZ | f32[cols*rows] heights.
  // Absent → loader falls back to deriving colliders from the instance buffer.
  COLLIDERS: 14,
  // Player physics tuning + locomotion speeds, baked so the shipped game feels
  // identical to the editor's play view instead of re-declaring constants in
  // world_loader.zig. Layout: u32 version | f32[13]: gravity, jumpSpeed,
  // playerRadius, playerHeight, stepHeight, wallRestitution, bodyRestitution,
  // walkableSidePushGrace, accelMultiplier, surfaceFriction, surfaceRestitution,
  // walkSpeed, runSpeed. Absent → loader keeps its built-in defaults.
  PHYSICS_CONFIG: 15,
  // The prop interaction layer (PROPUSE req_0624): seat/container ARCHETYPES
  // (one per prop kind — label, sit/lay pose + height, search seconds, access,
  // loot category) plus thin instance refs (archetype index + transform), so
  // the no-V8 loader carries /test's E-to-sit/search capability as data.
  // Layout: cart/hmsc-int/compile/worldInteractables.ts encodeInteractables.
  INTERACTABLES: 16,
  // Kickable dynamic props (KICKPROP req_0625): per prop a sphere-body recipe
  // (radius/restitution from the kind registry's dynamics) + its render parts
  // as LOCAL 13-float rows. The loader steps them through the host physics
  // entity section and renders them as live nodes — balls roll, cones shove.
  // Layout: cart/hmsc-int/compile/worldDynamicProps.ts encodeDynamicProps.
  DYNAMIC_PROPS: 17,
  // Elevator shafts (REQ-0652): per shaft the car footprint/thickness/speed,
  // the module footprint, and one stop level per stacked storey. The loader
  // appends a LIVE car rect per shaft to its physics buffer and rides it —
  // E to ride/call, exactly /test's elevator. Absent → no cars (the shaft
  // frames still render/collide through INSTANCES + COLLIDERS).
  // Layout: cart/hmsc-int/compile/worldElevators.ts encodeElevators.
  ELEVATORS: 18,
  // Door panels (DOORS-0611, req_0654): per interactable wall cutout
  // (door/garageDoor) the closed panel's box + reach + flags. The loader
  // appends one LIVE rect per door and renders one live panel node — E
  // toggles the two-state machine (closed blocks body+eye, open is clear),
  // /test's door. Absent → no leaves (the wall jambs still render/collide).
  // Layout: cart/hmsc-int/compile/worldDoors.ts encodeDoors.
  DOORS: 19,
  // Imported OBJ/GLB prop meshes: shared baked vertex payloads plus placed
  // transforms. Layout: cart/hmsc-int/compile/worldGeometry.ts encodeMeshProps.
  MESH_PROPS: 20,
  // Bodies of water (world/water): each a flat surface-level height grid the
  // loader renders as a translucent heightfield with a host-clock travelling
  // wave (animated ripples in the shipped game). Header carries the shared
  // look + wave; the per-body grid + skirt make a wadeable volume. Absent → no
  // water. Layout: cart/hmsc-int/compile/worldGeometry.ts encodeWaterBodies.
  WATER: 21,
  // Player-stats config (GAME_STATS): the flat, declarative tuning the stat
  // formulas read — vitals maxes/starts, energy drain/regen, the wanted decay +
  // 6 star thresholds, the carry-capacity FACTOR tables (pocket-by-pants,
  // pack-by-backpack), the xp curve, the per-skill effect coefficients and the
  // event→xp rates. Baked so the no-V8 loader seeds the SAME numbers as the
  // editor instead of re-declaring constants (GUIDING_LIGHT: store the config,
  // the engine stays dumb). Fixed layout: u32 version | f32[43]; field order in
  // cart/hmsc-int/compile/playerStats.ts encodeStatsConfig. Absent → loader
  // keeps its built-in stat defaults.
  STATS_CONFIG: 22,
  // LED ticker boards (req_0893 #3): per ticker — anchor + yaw + board dims +
  // lit color + scroll speed + the message's column bitmasks. world_loader.zig
  // scrolls + draws the lit LEDs per frame (the elevator-car pattern). Layout in
  // cart/hmsc-int/compile/worldTicker.ts encodeTickers. Absent → no tickers.
  TICKER: 23,
  // NPC population (req_0935): the figures that walk the compiled world, baked
  // as DATA the no-V8 loader renders with the player figure's own machinery.
  // NPC_MODELS = u32 version | u32 modelCount | per model: u32 groupCount |
  // groups[] (each group the SAME 68-byte header + verts(+texture) as
  // PLAYER_MODEL — see cart/hmsc-int/compile/npcModels.ts). NPCs reuse
  // PLAYER_ANIMATION unchanged (shared skeleton). Absent → no NPCs.
  NPC_MODELS: 24,
  // NPC_SPAWNS = u32 version | u32 count | per spawn: u32 modelIndex |
  // f32 x,z,yaw | u32 kind | u32 faction. The loader grounds each on the
  // terrain (no baked y) and animates it; kind/faction are reserved for the
  // Stage-2 Zig combat AI. Layout: cart/hmsc-int/compile/npcModels.ts.
  NPC_SPAWNS: 25,
  // Foliage RECIPE (FOLIAGEFORMULA, req_1588/1591): painted flora is a pure
  // deterministic formula, so instead of baking ~1M expanded blade rows into
  // INSTANCES (56MB of a 70MB file — 99.4% of the instances) we ship only the
  // FACTORS — the painted foliage CELLS — and the loader expands recipes at load
  // via framework/world/foliage.zig (blades plus shared whole-plant meshes).
  // Layout: u32 version | f32 cellSizeMeters | u32 cellCount | per cell:
  // u32 cellKey | f32 wx | f32 wz | f32 top | u16 append-only specId | u16
  // count (unused by whole plants). Absent → no recipe foliage (legacy bakes ship rows in
  // INSTANCES). See cart/hmsc-int/compile/worldGeometry.ts encodeFlora.
  FLORA: 26,
  // Per-instance-row WALL flag (u32 count | u8[count]); 1 = the row is a wall
  // piece (catalog kind 'wall'), 0 = anything else. Parallel to INSTANCES rows
  // (req_2053). Lets the editor's build pane hide walls so you can edit a
  // building's interior — world_loader.zig collapses the flagged rows live when
  // the editor toggles __compiled_world_set_hide_walls (no rebake). Absent → no
  // row is a wall (the toggle then hides nothing). See worldGeometry.ts
  // encodeWallFlags.
  WALL_FLAGS: 27,
  // Ambient road traffic (req_2056): per vehicle — a buildVehicle prototype
  // (instance rows in local space: pos3/rot3/scale3/color3/shape) + a looping
  // route polyline + cruise speed + phase. world_loader.zig samples each route
  // per frame (arc-length mod loop length) and rebuilds the vehicle's instance
  // rows at the pose — the LED-ticker mutable-instance pattern. Routes are baked
  // by flow-following the lane tiles (no host A*). Layout:
  // cart/hmsc-int/compile/worldTraffic.ts encodeTraffic. Absent → no traffic.
  TRAFFIC: 28,
} as const;

export type LumpInput = {
  type: number;
  encoding: LumpEncoding;
  data: Uint8Array;
};

export type LumpDirectoryEntry = {
  type: number;
  encoding: LumpEncoding;
  offset: number;
  length: number;
  decodedLength: number;
};

export type LumpRecord = LumpDirectoryEntry & {
  data: Uint8Array;
};

const ENCODING_BY_ID: Record<number, LumpEncoding> = {
  [LUMP_ENCODING.raw]: 'raw',
  [LUMP_ENCODING.rle8]: 'rle8',
  [LUMP_ENCODING.rle16]: 'rle16',
  [LUMP_ENCODING.text]: 'text',
};

export function textBytes(text: string): Uint8Array {
  const encoder = (globalThis as any).TextEncoder;
  if (typeof encoder === 'function') return new encoder().encode(text);
  const binary = unescape(encodeURIComponent(text));
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i) & 255;
  return out;
}

export function bytesText(bytes: Uint8Array): string {
  const decoder = (globalThis as any).TextDecoder;
  if (typeof decoder === 'function') return new decoder().decode(bytes);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return decodeURIComponent(escape(binary));
}

export function bytesToBase64(bytes: Uint8Array): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i] ?? 0;
    const b = bytes[i + 1] ?? 0;
    const c = bytes[i + 2] ?? 0;
    const n = (a << 16) | (b << 8) | c;
    out += chars[(n >>> 18) & 63];
    out += chars[(n >>> 12) & 63];
    out += i + 1 < bytes.length ? chars[(n >>> 6) & 63] : '=';
    out += i + 2 < bytes.length ? chars[n & 63] : '=';
  }
  return out;
}

export function base64ToBytes(value: string): Uint8Array {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const clean = value.replace(/\s+/g, '');
  const out: number[] = [];
  for (let i = 0; i < clean.length; i += 4) {
    const c0 = chars.indexOf(clean[i] ?? 'A');
    const c1 = chars.indexOf(clean[i + 1] ?? 'A');
    const c2 = clean[i + 2] === '=' ? -1 : chars.indexOf(clean[i + 2] ?? 'A');
    const c3 = clean[i + 3] === '=' ? -1 : chars.indexOf(clean[i + 3] ?? 'A');
    if (c0 < 0 || c1 < 0 || (c2 < 0 && clean[i + 2] !== '=') || (c3 < 0 && clean[i + 3] !== '=')) {
      throw new Error('invalid base64');
    }
    const n = (c0 << 18) | (c1 << 12) | ((c2 < 0 ? 0 : c2) << 6) | (c3 < 0 ? 0 : c3);
    out.push((n >>> 16) & 255);
    if (c2 >= 0) out.push((n >>> 8) & 255);
    if (c3 >= 0) out.push(n & 255);
  }
  return new Uint8Array(out);
}

function align(value: number, boundary = LUMP_ALIGNMENT): number {
  return Math.ceil(value / boundary) * boundary;
}

function encodingId(encoding: LumpEncoding): number {
  return LUMP_ENCODING[encoding];
}

function encodingName(id: number): LumpEncoding {
  const encoding = ENCODING_BY_ID[id];
  if (!encoding) throw new Error(`unknown lump encoding id ${id}`);
  return encoding;
}

export function writeLumpContainer(lumps: LumpInput[]): Uint8Array {
  const directoryBytes = lumps.length * LUMP_DIRECTORY_ENTRY_BYTES;
  let dataOffset = align(LUMP_HEADER_BYTES + directoryBytes);
  const entries: LumpDirectoryEntry[] = [];
  for (const lump of lumps) {
    dataOffset = align(dataOffset);
    entries.push({
      type: lump.type >>> 0,
      encoding: lump.encoding,
      offset: dataOffset,
      length: lump.data.byteLength,
      decodedLength: lump.data.byteLength,
    });
    dataOffset += lump.data.byteLength;
  }

  const out = new Uint8Array(dataOffset);
  const view = new DataView(out.buffer);
  view.setUint32(0, LUMP_MAGIC, true);
  view.setUint16(4, LUMP_FORMAT_VERSION, true);
  view.setUint16(6, LUMP_ALIGNMENT, true);
  view.setUint32(8, lumps.length, true);
  view.setUint32(12, LUMP_HEADER_BYTES, true);

  for (let i = 0; i < entries.length; i += 1) {
    const entry = entries[i]!;
    const at = LUMP_HEADER_BYTES + i * LUMP_DIRECTORY_ENTRY_BYTES;
    view.setUint32(at + 0, entry.type, true);
    view.setUint16(at + 4, encodingId(entry.encoding), true);
    view.setUint16(at + 6, 0, true);
    view.setUint32(at + 8, entry.offset, true);
    view.setUint32(at + 12, entry.length, true);
    view.setUint32(at + 16, entry.decodedLength, true);
    view.setUint32(at + 20, 0, true);
    out.set(lumps[i]!.data, entry.offset);
  }
  return out;
}

export function readLumpContainer(bytes: Uint8Array, opts: { knownTypes?: Set<number> } = {}): LumpRecord[] {
  if (bytes.byteLength < LUMP_HEADER_BYTES) throw new Error('mapfile too small');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(0, true) !== LUMP_MAGIC) throw new Error('bad mapfile magic');
  const version = view.getUint16(4, true);
  if (version !== LUMP_FORMAT_VERSION) throw new Error(`unsupported mapfile version ${version}`);
  const count = view.getUint32(8, true);
  const dirOffset = view.getUint32(12, true);
  const dirEnd = dirOffset + count * LUMP_DIRECTORY_ENTRY_BYTES;
  if (dirEnd > bytes.byteLength) throw new Error('lump directory extends past file');

  const records: LumpRecord[] = [];
  for (let i = 0; i < count; i += 1) {
    const at = dirOffset + i * LUMP_DIRECTORY_ENTRY_BYTES;
    const type = view.getUint32(at + 0, true);
    const encoding = encodingName(view.getUint16(at + 4, true));
    const offset = view.getUint32(at + 8, true);
    const length = view.getUint32(at + 12, true);
    const decodedLength = view.getUint32(at + 16, true);
    if (offset + length > bytes.byteLength) throw new Error(`lump ${type} extends past file`);
    if (opts.knownTypes && !opts.knownTypes.has(type)) continue;
    records.push({
      type,
      encoding,
      offset,
      length,
      decodedLength,
      data: bytes.slice(offset, offset + length),
    });
  }
  return records;
}

export function findLump(records: LumpRecord[], type: number): LumpRecord | null {
  return records.find((record) => record.type === type) ?? null;
}

export function encodeBinaryRleGrid(grid: RleGrid, bits: 8 | 16): Uint8Array {
  const values = decodeGrid(grid);
  const pairs: Array<[number, number]> = [];
  for (let y = 0; y < grid.h; y += 1) {
    let x = 0;
    while (x < grid.w) {
      const value = values[y * grid.w + x] ?? null;
      let run = 1;
      while (x + run < grid.w && (values[y * grid.w + x + run] ?? null) === value && run < 0xffff) run += 1;
      const encoded = value === null ? 0 : value + 1;
      const maxValue = bits === 8 ? 0xff : 0xffff;
      if (encoded < 0 || encoded > maxValue) throw new Error(`rle${bits} value out of range: ${value}`);
      pairs.push([run, encoded]);
      x += run;
    }
  }

  const pairBytes = bits === 8 ? 3 : 4;
  const out = new Uint8Array(12 + pairs.length * pairBytes);
  const view = new DataView(out.buffer);
  view.setUint32(0, grid.w, true);
  view.setUint32(4, grid.h, true);
  view.setUint32(8, pairs.length, true);
  let at = 12;
  for (const [count, value] of pairs) {
    view.setUint16(at, count, true);
    if (bits === 8) {
      view.setUint8(at + 2, value);
      at += 3;
    } else {
      view.setUint16(at + 2, value, true);
      at += 4;
    }
  }
  return out;
}

export function decodeBinaryRleGrid(bytes: Uint8Array, bits: 8 | 16): RleGrid {
  if (bytes.byteLength < 12) throw new Error(`rle${bits} payload too small`);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const w = view.getUint32(0, true);
  const h = view.getUint32(4, true);
  const pairCount = view.getUint32(8, true);
  const pairBytes = bits === 8 ? 3 : 4;
  if (12 + pairCount * pairBytes > bytes.byteLength) throw new Error(`rle${bits} payload truncated`);
  const values: Array<number | null> = new Array(w * h).fill(null);
  let at = 12;
  let index = 0;
  for (let i = 0; i < pairCount; i += 1) {
    const count = view.getUint16(at, true);
    const encoded = bits === 8 ? view.getUint8(at + 2) : view.getUint16(at + 2, true);
    at += pairBytes;
    const value = encoded === 0 ? null : encoded - 1;
    for (let n = 0; n < count && index < values.length; n += 1) values[index++] = value;
  }
  return encodeGrid(values, w, h);
}

export type QuantizedHeightfield = {
  w: number;
  h: number;
  base: number;
  scale: number;
  quantized: RleGrid;
};

export function quantizeHeightfield(heights: number[], w: number, h: number): QuantizedHeightfield {
  if (heights.length !== w * h) throw new Error('heightfield size mismatch');
  let min = Infinity;
  let max = -Infinity;
  for (const height of heights) {
    if (height < min) min = height;
    if (height > max) max = height;
  }
  const base = Number.isFinite(min) ? min : 0;
  const span = Math.max(0, (Number.isFinite(max) ? max : 0) - base);
  const scale = span === 0 ? 1 : span / 0xffff;
  const values = heights.map((height) => Math.max(0, Math.min(0xffff, Math.round((height - base) / scale))));
  return { w, h, base, scale, quantized: encodeGrid(values, w, h) };
}

export function dequantizeHeightfield(field: QuantizedHeightfield): number[] {
  return decodeGrid(field.quantized).map((value) => field.base + (value ?? 0) * field.scale);
}
