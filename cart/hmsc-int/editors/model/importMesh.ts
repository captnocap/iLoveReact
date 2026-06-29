// importMesh.ts — turn an external triangle mesh (GLB/OBJ) into a Studio EditMesh so
// a GENERATED model (see tools/genmesh) can be opened in the Studio and PAINTED,
// instead of only baking to a static prop via importPropMesh.mjs.
//
// This is the inverse of editMesh's `editMeshToGeometry` lowering: that flattens
// an EditMesh to GeometryData triangle soup; this lifts triangle soup back into
// the topological EditMesh (shared verts + per-tri faces) the Studio edits. After
// conversion the caller runs `unwrap()` (per-face UV islands) so the pixel painter
// — which requires `face.uv` — works on every triangle.
//
// MEMORY (req_2078): a Studio EditMesh is editable, paintable, and UNDOABLE — every
// face is a JS object, every vert an array, and the whole thing is JSON-serialized
// into a 4MB localstore value. So it is a LOW-POLY part store: a 9–14MB scan/sculpt
// (100k–1M+ tris) cannot live here as-is, and the naive lift OOM-killed V8 (a boxed
// array per byte/vert/tri + a string-keyed weld map). The pipeline is now:
//   bytes/text → MeshSoup (flat typed arrays — cheap, never OOMs)
//             → decimateSoup(grid)  (vertex-clustering, the import "Detail" knob)
//             → soupToEditMesh + unwrap  (objects allocated for the SMALL result only)
// The heavy object allocation happens once, on the already-shrunk mesh. The dialog
// exposes the grid as a Detail slider with a live triangle count, and Import is gated
// by MAX_IMPORT_TRIS so the saved model always fits the localstore ceiling.
//
// Pure + headless (no host doors): the GLB bytes are passed in, so importMesh.test.ts
// can prove the parse + weld. The Studio reads the bytes via runtime/hooks/fs's
// `__fs_read_base64` and hands them here.
//
// NOTE: the GLB-parsing here mirrors tools/importPropMesh.mjs, which runs in the
// standalone v8cli host (different module system) and emits a flat render buffer.
// Unifying the two parsers behind one shared module is a rule-of-two follow-up.

import { unwrap, type EditMesh, type EditMeshFace, type V3 } from './editMesh';

// A welded, editable+paintable+unwrapped EditMesh is JSON'd into a 4MB localstore
// value ALONGSIDE the rest of the editor state. At ~120 bytes/tri (face object +
// shared vert + per-corner uv) a 25k-tri model is already ~3MB, so this is the hard
// ceiling that keeps a single import from blowing the editor-state save (the
// BufferTooSmall in req_2078); the dialog defaults well under it.
export const MAX_IMPORT_TRIS = 25_000;

// ── base64 → bytes ─────────────────────────────────────────────────────────────
// Single-pass into a pre-sized Uint8Array. The old version pushed one element per
// byte into a JS number[] — a 14MB GLB became a 14-million-element boxed array
// before parsing even began, the first leg of the req_2078 OOM. Skips any char not
// in the table (whitespace, '='), so it tolerates wrapped/padded base64.
const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const B64LUT = /* one-time reverse lookup */ (() => {
  const t = new Int16Array(256).fill(-1);
  for (let i = 0; i < B64.length; i += 1) t[B64.charCodeAt(i)] = i;
  return t;
})();
export function base64ToBytes(value: string): Uint8Array {
  const n = value.length;
  const out = new Uint8Array(((n >> 2) + 1) * 3); // upper bound; trimmed below
  let buf = 0;
  let bits = 0;
  let o = 0;
  for (let i = 0; i < n; i += 1) {
    const v = B64LUT[value.charCodeAt(i) & 255];
    if (v < 0) continue;
    buf = (buf << 6) | v;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[o] = (buf >> bits) & 255;
      o += 1;
    }
  }
  return out.subarray(0, o);
}

// ── MeshSoup: the flat, typed-array carrier (never OOMs, decimates cheaply) ─────
/** Positions are x,y,z triples (length = vertCount*3); indices are 3 per triangle
 *  (length = triCount*3). This is the heavy mesh's only in-memory form until it has
 *  been shrunk under MAX_IMPORT_TRIS — only then do we mint per-vert/per-face JS
 *  objects (soupToEditMesh). */
export type MeshSoup = { positions: Float32Array; indices: Uint32Array };
export const soupVertCount = (s: MeshSoup): number => s.positions.length / 3;
export const soupTriCount = (s: MeshSoup): number => s.indices.length / 3;

// ── minimal GLB reader (v2, TRIANGLES) ─────────────────────────────────────────
type Mat4 = number[];

function dv(b: Uint8Array): DataView {
  return new DataView(b.buffer, b.byteOffset, b.byteLength);
}
function u32(b: Uint8Array, at: number): number {
  return dv(b).getUint32(at, true);
}
function ascii(b: Uint8Array, a: number, z: number): string {
  let s = '';
  for (let i = a; i < z; i += 1) s += String.fromCharCode(b[i]);
  return s;
}

function glbChunks(bytes: Uint8Array): { json: any; bin: Uint8Array } {
  if (ascii(bytes, 0, 4) !== 'glTF') throw new Error('not a GLB file');
  if (u32(bytes, 4) !== 2) throw new Error('only GLB v2 is supported');
  const length = u32(bytes, 8);
  let at = 12;
  let json: any = null;
  let bin: Uint8Array | null = null;
  while (at + 8 <= length) {
    const chunkLength = u32(bytes, at);
    const chunkType = u32(bytes, at + 4);
    const data = bytes.subarray(at + 8, at + 8 + chunkLength);
    // TextDecoder over the JSON chunk in one shot — the old char-by-char ascii()
    // string-built a multi-hundred-KB header one codepoint at a time.
    if (chunkType === 0x4e4f534a) json = JSON.parse(new TextDecoder().decode(data));
    if (chunkType === 0x004e4942) bin = data;
    at += 8 + chunkLength;
  }
  if (!json || !bin) throw new Error('GLB must contain JSON and BIN chunks');
  return { json, bin };
}

const COMPONENT_BYTES: Record<number, number> = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 };
const TYPE_COMPONENTS: Record<string, number> = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };

function readComponent(b: Uint8Array, at: number, componentType: number): number {
  const view = dv(b);
  if (componentType === 5120) return view.getInt8(at);
  if (componentType === 5121) return b[at];
  if (componentType === 5122) return view.getInt16(at, true);
  if (componentType === 5123) return view.getUint16(at, true);
  if (componentType === 5125) return view.getUint32(at, true);
  if (componentType === 5126) return view.getFloat32(at, true);
  throw new Error(`unsupported component type ${componentType}`);
}

type AccessorMeta = { count: number; componentType: number; comps: number; offset: number; stride: number };
function accessorMeta(json: any, index: number): AccessorMeta {
  const accessor = json.accessors?.[index];
  if (!accessor) throw new Error(`missing accessor ${index}`);
  const view = json.bufferViews?.[accessor.bufferView];
  if (!view) throw new Error(`missing bufferView ${accessor.bufferView}`);
  const cBytes = COMPONENT_BYTES[accessor.componentType];
  const comps = TYPE_COMPONENTS[accessor.type];
  if (!cBytes || !comps) throw new Error(`unsupported accessor ${accessor.type}/${accessor.componentType}`);
  return {
    count: accessor.count,
    componentType: accessor.componentType,
    comps,
    offset: (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0),
    stride: view.byteStride ?? cBytes * comps,
  };
}

/** Read a VEC3 POSITION accessor straight into a Float32Array, applying the node
 *  matrix as we go — no intermediate number[][] (one boxed array per vertex was the
 *  second leg of the OOM). */
function readPositions(json: any, bin: Uint8Array, index: number, m: Mat4): Float32Array {
  const a = accessorMeta(json, index);
  if (a.comps !== 3) throw new Error('POSITION must be VEC3');
  const cBytes = COMPONENT_BYTES[a.componentType];
  const out = new Float32Array(a.count * 3);
  for (let i = 0; i < a.count; i += 1) {
    const at = a.offset + i * a.stride;
    const x = readComponent(bin, at, a.componentType);
    const y = readComponent(bin, at + cBytes, a.componentType);
    const z = readComponent(bin, at + 2 * cBytes, a.componentType);
    out[i * 3] = m[0] * x + m[4] * y + m[8] * z + m[12];
    out[i * 3 + 1] = m[1] * x + m[5] * y + m[9] * z + m[13];
    out[i * 3 + 2] = m[2] * x + m[6] * y + m[10] * z + m[14];
  }
  return out;
}

function readIndices(json: any, bin: Uint8Array, index: number): Uint32Array {
  const a = accessorMeta(json, index);
  const cBytes = COMPONENT_BYTES[a.componentType];
  const out = new Uint32Array(a.count);
  for (let i = 0; i < a.count; i += 1) out[i] = readComponent(bin, a.offset + i * a.stride, a.componentType);
  return out;
}

function mat4Identity(): Mat4 { return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]; }
function mat4Mul(a: Mat4, b: Mat4): Mat4 {
  const out = new Array(16).fill(0);
  for (let col = 0; col < 4; col += 1)
    for (let row = 0; row < 4; row += 1)
      out[col * 4 + row] = a[row] * b[col * 4] + a[4 + row] * b[col * 4 + 1] + a[8 + row] * b[col * 4 + 2] + a[12 + row] * b[col * 4 + 3];
  return out;
}
function mat4FromNode(node: any): Mat4 {
  if (node.matrix) return node.matrix.slice();
  const t = node.translation ?? [0, 0, 0];
  const s = node.scale ?? [1, 1, 1];
  const [x, y, z, w] = node.rotation ?? [0, 0, 0, 1];
  const xx = x * x, yy = y * y, zz = z * z, xy = x * y, xz = x * z, yz = y * z, wx = w * x, wy = w * y, wz = w * z;
  return [
    (1 - 2 * (yy + zz)) * s[0], (2 * (xy + wz)) * s[0], (2 * (xz - wy)) * s[0], 0,
    (2 * (xy - wz)) * s[1], (1 - 2 * (xx + zz)) * s[1], (2 * (yz + wx)) * s[1], 0,
    (2 * (xz + wy)) * s[2], (2 * (yz - wx)) * s[2], (1 - 2 * (xx + yy)) * s[2], 0,
    t[0], t[1], t[2], 1,
  ];
}

/** Parse a GLB into a single MeshSoup in world space (node TRS applied, all meshes
 *  merged). Positions only — Studio re-derives normals and unwraps fresh UVs. */
export function glbToSoup(bytes: Uint8Array): MeshSoup {
  const { json, bin } = glbChunks(bytes);
  const chunks: { pos: Float32Array; idx: Uint32Array }[] = [];
  let totalVerts = 0;
  let totalIdx = 0;

  const emit = (primitive: any, matrix: Mat4) => {
    if ((primitive.mode ?? 4) !== 4) throw new Error('only GLB TRIANGLES primitives are supported');
    const pos = readPositions(json, bin, primitive.attributes.POSITION, matrix);
    const vc = pos.length / 3;
    const idx = primitive.indices === undefined
      ? Uint32Array.from({ length: vc }, (_, i) => i)
      : readIndices(json, bin, primitive.indices);
    chunks.push({ pos, idx });
    totalVerts += vc;
    totalIdx += idx.length;
  };

  const visit = (nodeIndex: number, parent: Mat4) => {
    const node = json.nodes?.[nodeIndex];
    if (!node) throw new Error(`missing node ${nodeIndex}`);
    const matrix = mat4Mul(parent, mat4FromNode(node));
    if (node.mesh !== undefined) {
      const mesh = json.meshes?.[node.mesh];
      if (!mesh) throw new Error(`missing mesh ${node.mesh}`);
      for (const primitive of mesh.primitives ?? []) emit(primitive, matrix);
    }
    for (const child of node.children ?? []) visit(child, matrix);
  };

  const scene = json.scenes?.[json.scene ?? 0];
  if (scene?.nodes?.length) for (const n of scene.nodes) visit(n, mat4Identity());
  else for (const mesh of json.meshes ?? []) for (const primitive of mesh.primitives ?? []) emit(primitive, mat4Identity());

  // Concatenate the per-primitive chunks once, rebasing each chunk's indices.
  const positions = new Float32Array(totalVerts * 3);
  const indices = new Uint32Array(totalIdx);
  let vBase = 0;
  let iAt = 0;
  for (const c of chunks) {
    positions.set(c.pos, vBase * 3);
    for (let i = 0; i < c.idx.length; i += 1) indices[iAt + i] = c.idx[i] + vBase;
    vBase += c.pos.length / 3;
    iAt += c.idx.length;
  }
  return { positions, indices };
}

// ── OBJ (InstantMesh and most generators also emit .obj) ───────────────────────
/** Parse a Wavefront OBJ into a MeshSoup. Positions + faces only (uv/normal/material
 *  ignored — Studio unwraps fresh and paints fresh); 1-based and negative indices
 *  supported; n-gon faces fan-triangulated. Two passes over the lines so the verts
 *  and indices land directly in typed arrays (no growing number[]). */
export function objToSoup(text: string): MeshSoup {
  const lines = text.split(/\r?\n/);
  // Pass 1 — count verts and triangles to size the typed arrays.
  let vCount = 0;
  let triCount = 0;
  for (const line of lines) {
    const c = line.charCodeAt(0);
    if (c === 118 /* v */ && line.charCodeAt(1) === 32) vCount += 1;
    else if (c === 102 /* f */ && line.charCodeAt(1) === 32) {
      let corners = 0;
      for (let i = 2; i < line.length; i += 1) {
        if (line.charCodeAt(i) === 32) continue;
        // start of a token
        corners += 1;
        while (i < line.length && line.charCodeAt(i) !== 32) i += 1;
      }
      if (corners >= 3) triCount += corners - 2;
    }
  }
  const positions = new Float32Array(vCount * 3);
  const indices = new Uint32Array(triCount * 3);
  // Pass 2 — fill. vSeen tracks running vertex count so negative (relative) OBJ
  // indices resolve against verts-so-far, exactly as the spec demands.
  let vSeen = 0;
  let iAt = 0;
  for (const line of lines) {
    const t = line.trim();
    if (!t || t[0] === '#') continue;
    const parts = t.split(/\s+/);
    if (parts[0] === 'v') {
      positions[vSeen * 3] = Number(parts[1]);
      positions[vSeen * 3 + 1] = Number(parts[2]);
      positions[vSeen * 3 + 2] = Number(parts[3]);
      vSeen += 1;
    } else if (parts[0] === 'f') {
      const idx: number[] = [];
      for (let p = 1; p < parts.length; p += 1) {
        const n = parseInt(parts[p].split('/')[0], 10); // strip /vt/vn; keep vertex index
        idx.push(n < 0 ? vSeen + n : n - 1); // negative = relative; else 1-based
      }
      for (let i = 1; i + 1 < idx.length; i += 1) {
        indices[iAt] = idx[0];
        indices[iAt + 1] = idx[i];
        indices[iAt + 2] = idx[i + 1];
        iAt += 3;
      }
    }
  }
  return { positions, indices };
}

// ── decimation: vertex clustering (the import "Detail" knob) ────────────────────
/** Snap a mesh onto a `grid`³ lattice over its bounding box, collapsing every vertex
 *  in a cell to the cell's average position and dropping triangles that fold flat.
 *  Higher grid = finer cells = more surviving detail. Cheap (one pass over verts +
 *  one over tris) and memory-flat — this is what lets a million-tri scan become a
 *  few-thousand-tri editable part instead of OOM-killing the heap. */
export function decimateSoup(s: MeshSoup, grid: number): MeshSoup {
  const R = Math.max(2, Math.min(1024, Math.floor(grid)));
  const p = s.positions;
  const vc = p.length / 3;
  let minx = Infinity, miny = Infinity, minz = Infinity;
  let maxx = -Infinity, maxy = -Infinity, maxz = -Infinity;
  for (let i = 0; i < vc; i += 1) {
    const x = p[i * 3], y = p[i * 3 + 1], z = p[i * 3 + 2];
    if (x < minx) minx = x; if (x > maxx) maxx = x;
    if (y < miny) miny = y; if (y > maxy) maxy = y;
    if (z < minz) minz = z; if (z > maxz) maxz = z;
  }
  const ext = Math.max(maxx - minx, maxy - miny, maxz - minz) || 1;
  const inv = R / ext;
  const cellMap = new Map<number, number>(); // cell key → new vertex index
  const sx: number[] = [], sy: number[] = [], sz: number[] = [], cnt: number[] = [];
  const remap = new Int32Array(vc);
  for (let i = 0; i < vc; i += 1) {
    const x = p[i * 3], y = p[i * 3 + 1], z = p[i * 3 + 2];
    let ix = Math.floor((x - minx) * inv); if (ix >= R) ix = R - 1; else if (ix < 0) ix = 0;
    let iy = Math.floor((y - miny) * inv); if (iy >= R) iy = R - 1; else if (iy < 0) iy = 0;
    let iz = Math.floor((z - minz) * inv); if (iz >= R) iz = R - 1; else if (iz < 0) iz = 0;
    const key = ix + iy * R + iz * R * R; // R≤1024 ⇒ key < 1.08e9, a safe integer
    let ni = cellMap.get(key);
    if (ni === undefined) {
      ni = sx.length;
      cellMap.set(key, ni);
      sx.push(x); sy.push(y); sz.push(z); cnt.push(1);
    } else {
      sx[ni] += x; sy[ni] += y; sz[ni] += z; cnt[ni] += 1;
    }
    remap[i] = ni;
  }
  const nvc = sx.length;
  const positions = new Float32Array(nvc * 3);
  for (let i = 0; i < nvc; i += 1) {
    const k = cnt[i];
    positions[i * 3] = sx[i] / k;
    positions[i * 3 + 1] = sy[i] / k;
    positions[i * 3 + 2] = sz[i] / k;
  }
  const src = s.indices;
  const tc = src.length / 3;
  const out: number[] = [];
  for (let t = 0; t < tc; t += 1) {
    const a = remap[src[t * 3]], b = remap[src[t * 3 + 1]], c = remap[src[t * 3 + 2]];
    if (a === b || b === c || a === c) continue; // collapsed flat — drop it
    out.push(a, b, c);
  }
  return { positions, indices: Uint32Array.from(out) };
}

/** Binary-search the grid resolution whose decimation lands nearest `targetTris`
 *  without exceeding it — used to seed the Detail slider so the default import is a
 *  clean low-poly mesh, never a blob and never over budget. */
export function gridForTargetTris(s: MeshSoup, targetTris: number): number {
  if (soupTriCount(s) <= targetTris) return 1024; // already small enough — full detail
  let lo = 2;
  let hi = 512;
  let best = lo;
  for (let iter = 0; iter < 9; iter += 1) {
    const mid = (lo + hi) >> 1;
    const tris = soupTriCount(decimateSoup(s, mid));
    if (tris <= targetTris) { best = mid; lo = mid + 1; } else { hi = mid - 1; }
    if (lo > hi) break;
  }
  return best;
}

// ── triangles → EditMesh ───────────────────────────────────────────────────────
export type RawTriangles = { verts: V3[]; tris: [number, number, number][] };

/** Build an EditMesh from a soup whose verts are ALREADY unique (post-decimation or
 *  post-weld): one shared vert per position, one 3-corner face per non-degenerate
 *  triangle. Throws if the soup is over MAX_IMPORT_TRIS — the caller must decimate
 *  first; this is the guard that turns "OOM the whole app" into a clean error. */
export function soupToEditMesh(s: MeshSoup): EditMesh {
  if (soupTriCount(s) > MAX_IMPORT_TRIS) {
    throw new Error(`mesh too detailed to import: ${soupTriCount(s).toLocaleString()} triangles (max ${MAX_IMPORT_TRIS.toLocaleString()}) — lower the Detail`);
  }
  const p = s.positions;
  const verts: V3[] = new Array(p.length / 3);
  for (let i = 0; i < verts.length; i += 1) verts[i] = [p[i * 3], p[i * 3 + 1], p[i * 3 + 2]];
  const faces: EditMeshFace[] = [];
  const idx = s.indices;
  for (let t = 0; t < idx.length; t += 3) {
    const a = idx[t], b = idx[t + 1], c = idx[t + 2];
    if (a === b || b === c || a === c) continue;
    faces.push({ loop: [a, b, c] });
  }
  return { verts, faces };
}

/** Lift a triangle set into an EditMesh: weld coincident positions (so the mesh is
 *  connected — adjacency, mirror, and editing all key off shared verts) and make one
 *  3-corner face per non-degenerate triangle. `weld` is the position quantization
 *  grid in model units. Used for small/hand-built triangle sets and the test suite;
 *  large imports go through decimateSoup → soupToEditMesh, which never builds a
 *  per-vertex string key. The result has NO uv yet — run `unwrap()` before painting. */
export function trianglesToEditMesh(raw: RawTriangles, weld = 1e-5): EditMesh {
  const map = new Map<string, number>();
  const verts: V3[] = [];
  const remap: number[] = new Array(raw.verts.length);
  const q = (n: number) => Math.round(n / weld);
  for (let i = 0; i < raw.verts.length; i += 1) {
    const p = raw.verts[i];
    const key = `${q(p[0])},${q(p[1])},${q(p[2])}`;
    let idx = map.get(key);
    if (idx === undefined) {
      idx = verts.length;
      verts.push([p[0], p[1], p[2]]);
      map.set(key, idx);
    }
    remap[i] = idx;
  }
  const faces: EditMeshFace[] = [];
  for (const [a, b, c] of raw.tris) {
    const ra = remap[a], rb = remap[b], rc = remap[c];
    if (ra === rb || rb === rc || rc === ra) continue; // degenerate after weld
    faces.push({ loop: [ra, rb, rc] });
  }
  return { verts, faces };
}

// ── back-compat shims (RawTriangles surface — tests + hand-built meshes) ────────
function soupToRaw(s: MeshSoup): RawTriangles {
  const p = s.positions;
  const verts: V3[] = new Array(p.length / 3);
  for (let i = 0; i < verts.length; i += 1) verts[i] = [p[i * 3], p[i * 3 + 1], p[i * 3 + 2]];
  const idx = s.indices;
  const tris: [number, number, number][] = new Array(idx.length / 3);
  for (let t = 0; t < tris.length; t += 1) tris[t] = [idx[t * 3], idx[t * 3 + 1], idx[t * 3 + 2]];
  return { verts, tris };
}

/** Parse a GLB into an indexed triangle set (RawTriangles surface). Prefer
 *  `glbToSoup` for large meshes; this materializes a boxed array per vert/tri. */
export function glbToTriangles(bytes: Uint8Array): RawTriangles {
  return soupToRaw(glbToSoup(bytes));
}

/** Parse a Wavefront OBJ into a RawTriangles set. Prefer `objToSoup` for large
 *  meshes; this materializes a boxed array per vert/tri. */
export function objToTriangles(text: string): RawTriangles {
  return soupToRaw(objToSoup(text));
}

/** Convenience: GLB bytes → unwrapped EditMesh, full detail (no decimation), guarded
 *  by MAX_IMPORT_TRIS. The Studio import dialog uses the soup + Detail-slider path
 *  instead so the user can dial big meshes down before this runs. */
export function glbToEditMesh(bytes: Uint8Array): EditMesh {
  return unwrap(soupToEditMesh(glbToSoup(bytes)));
}

/** Convenience: OBJ text → unwrapped EditMesh, full detail (no decimation), guarded
 *  by MAX_IMPORT_TRIS. */
export function objToEditMesh(text: string): EditMesh {
  return unwrap(soupToEditMesh(objToSoup(text)));
}
