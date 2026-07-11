// Editor-owned codec for unique, scannable in-world mission codes.
// Codes are minted from a
// mission key (req_1620 / req_1621). The authoring half of the QR-mission idea:
// create a mission → mint a code bound to it → import the code as a DECAL and
// paint/place it on a prop. The in-game "scan" (look-at + interact, resolved by
// the unbuilt phone) is a SEPARATE follow-up — but the code is a real, decodable
// codec NOW, so that scanner can read it rather than re-deriving a lookup.
//
// WHY a decal shader, not a grid of rects: a decal caps at MAX_NODES=256 and a
// rect node's fillData caps at 64 floats (decal.ts). A 25×25 code is 625 modules
// — far past both. So a code is ONE rect node with a `mission-code` Effect fill
// whose fillData bit-packs the module grid (the repo idiom: discrete field = a
// shader fill, not geometry — [[feedback_effect_is_the_shader_surface]],
// [[feedback_shader_vs_polyline]]). The twin shader spec lives in shaders.ts.
//
// PACKING (the f32 data[] the shader reads — mirror of CUTOUT_STENCIL's layout):
//   D[0]      N          modules per side (square)
//   D[1..3]   dark r,g,b (0..1) — a set module
//   D[4..6]   light r,g,b
//   D[7]      light alpha (the quiet zone + clear modules; 0 = floats on transp.)
//   D[8]      quiet      quiet-zone cells per side (rendered light)
//   D[9]      wordBits   bits packed per f32 word (= WORD_BITS)
//   D[10]     reserved (0)
//   D[11+]    words      row-major modules, wordBits per word, LSB = first module
// 20 bits/word stays < 2^24 so each word is an EXACT integer in f32 (u32(D[i])
// round-trips). N≤31 ⇒ ≤49 words ⇒ ≤60 floats, under the 64 cap.
//
// Data only — no React imports (the decal.ts law). The codec round-trips
// (encode→decode) so it is unit-testable headless; uniqueness falls out of the
// payload+CRC. See missionCode.test.ts.

import { DECAL_DOC_VERSION, type DecalDoc, type DecalRectNode } from './decal';

// ── codec constants ──────────────────────────────────────────────────────────
const CODE_VERSION = 1;          // payload byte 0 — bump if the wire format changes
const FINDER = 7;                // QR-style finder pattern is 7×7
const CORNER = FINDER + 1;       // finder + 1-cell separator = reserved 8×8 corner block
const WORD_BITS = 20;            // bits per packed f32 word (exact < 2^24)
const MAX_KEY_BYTES = 200;       // loud cap [[feedback_juice_limits_dont_set_low]]
// Allowed module counts (odd, ascending). 3 corners reserve 3·CORNER² cells; the
// rest carry payload bits. N=21 holds ~31 bytes, N=31 holds ~96 — mission keys
// are slugs, so this is generous headroom, not a low cap.
const SIZES = [21, 25, 29, 31];

// ── UTF-8 (dependency-free; v8cli has no TextEncoder guarantee) ───────────────
function utf8Encode(s: string): number[] {
  const out: number[] = [];
  for (let i = 0; i < s.length; i += 1) {
    let c = s.charCodeAt(i);
    // surrogate pair → code point
    if (c >= 0xd800 && c <= 0xdbff && i + 1 < s.length) {
      const lo = s.charCodeAt(i + 1);
      if (lo >= 0xdc00 && lo <= 0xdfff) { c = 0x10000 + ((c - 0xd800) << 10) + (lo - 0xdc00); i += 1; }
    }
    if (c < 0x80) out.push(c);
    else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 0x3f));
    else if (c < 0x10000) out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f));
    else out.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 0x3f), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f));
  }
  return out;
}

function utf8Decode(bytes: number[]): string | null {
  let out = '';
  let i = 0;
  while (i < bytes.length) {
    const b = bytes[i];
    let cp: number;
    let n: number;
    if (b < 0x80) { cp = b; n = 0; }
    else if ((b & 0xe0) === 0xc0) { cp = b & 0x1f; n = 1; }
    else if ((b & 0xf0) === 0xe0) { cp = b & 0x0f; n = 2; }
    else if ((b & 0xf8) === 0xf0) { cp = b & 0x07; n = 3; }
    else return null;
    if (i + n >= bytes.length) return null;
    for (let k = 0; k < n; k += 1) {
      const cont = bytes[i + 1 + k];
      if ((cont & 0xc0) !== 0x80) return null;
      cp = (cp << 6) | (cont & 0x3f);
    }
    out += String.fromCodePoint(cp);
    i += n + 1;
  }
  return out;
}

// CRC-8 (poly 0x07, init 0) — a one-byte integrity check so a misread code
// decodes to null instead of a wrong mission.
function crc8(bytes: number[]): number {
  let crc = 0;
  for (const b of bytes) {
    crc ^= b & 0xff;
    for (let k = 0; k < 8; k += 1) crc = (crc & 0x80) ? ((crc << 1) ^ 0x07) & 0xff : (crc << 1) & 0xff;
  }
  return crc & 0xff;
}

// payload = [VERSION, len, ...utf8(key), crc8(prev)]
function payloadBytes(key: string): number[] {
  const ascii = utf8Encode(key);
  if (ascii.length > MAX_KEY_BYTES) throw new Error(`mission code: key is ${ascii.length} bytes, over the ${MAX_KEY_BYTES} cap`);
  const body = [CODE_VERSION, ascii.length, ...ascii];
  body.push(crc8(body));
  return body;
}

function dataCapacityBits(n: number): number {
  return (n * n - 3 * CORNER * CORNER) * 1;
}

function chooseSize(key: string): number {
  const need = payloadBytes(key).length * 8;
  for (const n of SIZES) if (dataCapacityBits(n) >= need) return n;
  throw new Error(`mission code: key "${key}" needs ${need} bits, over the largest grid (${SIZES[SIZES.length - 1]})`);
}

// The three reserved 8×8 corner blocks (TL, TR, BL). The bottom-right corner is
// deliberately free — three finders is how a reader recovers orientation.
function reservedAt(n: number, x: number, y: number): boolean {
  const tl = x < CORNER && y < CORNER;
  const tr = x >= n - CORNER && y < CORNER;
  const bl = x < CORNER && y >= n - CORNER;
  return tl || tr || bl;
}

// Stamp a 7×7 QR-style finder (outer ring + 3×3 core) at a corner offset.
function placeFinder(cells: Uint8Array, n: number, ox: number, oy: number): void {
  for (let r = 0; r < FINDER; r += 1) {
    for (let c = 0; c < FINDER; c += 1) {
      const ring = r === 0 || r === FINDER - 1 || c === 0 || c === FINDER - 1;
      const core = r >= 2 && r <= 4 && c >= 2 && c <= 4;
      cells[(oy + r) * n + (ox + c)] = ring || core ? 1 : 0;
    }
  }
}

/** The module grid for a mission key: 0 = light, 1 = dark. Round-trips with
 *  {@link decodeMissionModules}. Deterministic — same key, same grid. */
export function encodeMissionModules(key: string): { size: number; cells: Uint8Array } {
  const n = chooseSize(key);
  const cells = new Uint8Array(n * n);
  placeFinder(cells, n, 0, 0);
  placeFinder(cells, n, n - FINDER, 0);
  placeFinder(cells, n, 0, n - FINDER);
  const bytes = payloadBytes(key);
  const totalBits = bytes.length * 8;
  let bit = 0;
  for (let y = 0; y < n; y += 1) {
    for (let x = 0; x < n; x += 1) {
      if (reservedAt(n, x, y)) continue;
      const mask = (x + y) & 1; // checkerboard mask breaks up runs (QR look + reader)
      if (bit < totalBits) {
        const v = (bytes[bit >> 3] >> (7 - (bit & 7))) & 1;
        cells[y * n + x] = v ^ mask;
        bit += 1;
      } else {
        cells[y * n + x] = mask; // pad cells are pure mask (noise); reader stops at len
      }
    }
  }
  return { size: n, cells };
}

/** Recover the mission key from a module grid, or null if it isn't a valid code
 *  (bad version, short, or CRC mismatch). The future in-game scanner reads this. */
export function decodeMissionModules(size: number, cells: Uint8Array): string | null {
  if (!SIZES.includes(size) || cells.length !== size * size) return null;
  const bits: number[] = [];
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      if (reservedAt(size, x, y)) continue;
      const mask = (x + y) & 1;
      bits.push((cells[y * size + x] ^ mask) & 1);
    }
  }
  const readByte = (idx: number): number => {
    let b = 0;
    for (let k = 0; k < 8; k += 1) b = (b << 1) | (bits[idx * 8 + k] || 0);
    return b;
  };
  if (bits.length < 24) return null;
  if (readByte(0) !== CODE_VERSION) return null;
  const len = readByte(1);
  const total = 2 + len + 1; // version + len + payload + crc
  if (bits.length < total * 8) return null;
  const body: number[] = [];
  for (let i = 0; i < total; i += 1) body.push(readByte(i));
  if (crc8(body.slice(0, -1)) !== body[body.length - 1]) return null;
  return utf8Decode(body.slice(2, 2 + len));
}

// ── shader data[] packing ────────────────────────────────────────────────────
function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  const v = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  const r = parseInt(v.slice(0, 2), 16);
  const g = parseInt(v.slice(2, 4), 16);
  const b = parseInt(v.slice(4, 6), 16);
  return [Number.isFinite(r) ? r / 255 : 0, Number.isFinite(g) ? g / 255 : 0, Number.isFinite(b) ? b / 255 : 0];
}

export type MissionCodeOpts = {
  dark?: string;        // set-module color (default near-black)
  light?: string;       // clear-module + quiet-zone color (default near-white)
  lightAlpha?: number;  // background alpha (0 = quiet zone is transparent)
  quiet?: number;       // quiet-zone cells per side
  size?: number;        // decal canvas px (square)
};

/** Pack the shader data[] from already-resolved float colors. The catalog slider
 *  form (shaders.ts) calls this directly; the doc generator routes hex through it. */
export function packMissionData(
  key: string,
  dark: [number, number, number],
  light: [number, number, number],
  lightAlpha = 1,
  quiet = 2,
): number[] {
  const { size, cells } = encodeMissionModules(key);
  const data = [size, dark[0], dark[1], dark[2], light[0], light[1], light[2], lightAlpha, quiet, WORD_BITS, 0];
  const words = Math.ceil((size * size) / WORD_BITS);
  for (let w = 0; w < words; w += 1) {
    let word = 0;
    for (let b = 0; b < WORD_BITS; b += 1) {
      const idx = w * WORD_BITS + b;
      if (idx < size * size && cells[idx]) word |= 1 << b;
    }
    data.push(word);
  }
  return data;
}

/** The shader data[] for a mission key (colors as hex). */
export function missionCodeData(key: string, opts: MissionCodeOpts = {}): number[] {
  return packMissionData(
    key,
    hexToRgb(opts.dark ?? '#0a0a0a'),
    hexToRgb(opts.light ?? '#f5f5f5'),
    opts.lightAlpha ?? 1,
    opts.quiet ?? 2,
  );
}

/** The stable decal/material id for a mission's code. */
export function missionCodeDecalId(key: string): string {
  return `mission-code:${key}`;
}

/** A mission code as a DecalDoc — one shader-filled rect, ready to ride the decal
 *  pipeline into the editor and the compiled world (MATERIALS lump). */
export function missionCodeDoc(key: string, opts: MissionCodeOpts = {}): DecalDoc {
  const size = opts.size ?? 512;
  const node: DecalRectNode = {
    id: 'code',
    kind: 'rect',
    x: 0,
    y: 0,
    w: size,
    h: size,
    bg: opts.light ?? '#f5f5f5',
    fillShaderId: 'mission-code',
    fillData: missionCodeData(key, opts),
  };
  return { version: DECAL_DOC_VERSION, width: size, height: size, bg: opts.light ?? '#f5f5f5', nodes: [node] };
}
