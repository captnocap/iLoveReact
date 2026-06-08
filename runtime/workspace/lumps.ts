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
