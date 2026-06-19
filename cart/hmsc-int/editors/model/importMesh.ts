// importMesh.ts — turn an external triangle mesh (GLB) into a Studio EditMesh so
// a GENERATED model (see tools/genmesh) can be opened in the Studio and PAINTED,
// instead of only baking to a static prop via importPropMesh.mjs.
//
// This is the inverse of editMesh's `editMeshToGeometry` lowering: that flattens
// an EditMesh to GeometryData triangle soup; this lifts triangle soup back into
// the topological EditMesh (shared verts + per-tri faces) the Studio edits. After
// conversion the caller runs `unwrap()` (per-face UV islands) so the pixel painter
// — which requires `face.uv` — works on every triangle.
//
// Pure + headless (no host doors): the GLB bytes are passed in, so importMesh.test.ts
// can prove the parse + weld. The Studio reads the bytes via runtime/hooks/fs's
// `__fs_read_base64` and hands them here.
//
// NOTE: the GLB-parsing here mirrors tools/importPropMesh.mjs, which runs in the
// standalone v8cli host (different module system) and emits a flat render buffer.
// Unifying the two parsers behind one shared module is a rule-of-two follow-up.

import { unwrap, type EditMesh, type EditMeshFace, type V3 } from './editMesh';

// ── base64 → bytes (fs.readFileBase64 hands the Studio a base64 string) ────────
const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
export function base64ToBytes(value: string): Uint8Array {
  const out: number[] = [];
  let buf = 0;
  let bits = 0;
  for (const ch of value.replace(/\s+/g, '')) {
    if (ch === '=') break;
    const v = B64.indexOf(ch);
    if (v < 0) continue;
    buf = (buf << 6) | v;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out.push((buf >> bits) & 255);
    }
  }
  return new Uint8Array(out);
}

// ── minimal GLB reader (v2, TRIANGLES) — returns indexed positions per mesh ────
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
    if (chunkType === 0x4e4f534a) json = JSON.parse(ascii(data, 0, data.length));
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

function readAccessor(json: any, bin: Uint8Array, index: number): number[][] | number[] {
  const accessor = json.accessors?.[index];
  if (!accessor) throw new Error(`missing accessor ${index}`);
  const view = json.bufferViews?.[accessor.bufferView];
  if (!view) throw new Error(`missing bufferView ${accessor.bufferView}`);
  const cBytes = COMPONENT_BYTES[accessor.componentType];
  const comps = TYPE_COMPONENTS[accessor.type];
  if (!cBytes || !comps) throw new Error(`unsupported accessor ${accessor.type}/${accessor.componentType}`);
  const offset = (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0);
  const stride = view.byteStride ?? cBytes * comps;
  if (comps === 1) {
    const out: number[] = [];
    for (let i = 0; i < accessor.count; i += 1) out.push(readComponent(bin, offset + i * stride, accessor.componentType));
    return out;
  }
  const out: number[][] = [];
  for (let i = 0; i < accessor.count; i += 1) {
    const at = offset + i * stride;
    const tuple: number[] = [];
    for (let c = 0; c < comps; c += 1) tuple.push(readComponent(bin, at + c * cBytes, accessor.componentType));
    out.push(tuple);
  }
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
function xform(m: Mat4, p: V3): V3 {
  return [
    m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12],
    m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13],
    m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14],
  ];
}

export type RawTriangles = { verts: V3[]; tris: [number, number, number][] };

/** Parse a GLB into a single indexed triangle set in world space (node TRS
 *  applied, all meshes merged). Positions only — Studio re-derives normals and
 *  unwraps fresh UVs. */
export function glbToTriangles(bytes: Uint8Array): RawTriangles {
  const { json, bin } = glbChunks(bytes);
  const verts: V3[] = [];
  const tris: [number, number, number][] = [];

  const emit = (primitive: any, matrix: Mat4) => {
    if ((primitive.mode ?? 4) !== 4) throw new Error('only GLB TRIANGLES primitives are supported');
    const base = verts.length;
    const positions = readAccessor(json, bin, primitive.attributes.POSITION) as number[][];
    for (const p of positions) verts.push(xform(matrix, p as V3));
    const indices = primitive.indices === undefined
      ? positions.map((_, i) => i)
      : (readAccessor(json, bin, primitive.indices) as number[]);
    for (let i = 0; i + 2 < indices.length; i += 3) {
      tris.push([base + indices[i], base + indices[i + 1], base + indices[i + 2]]);
    }
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
  return { verts, tris };
}

// ── triangles → EditMesh (weld + per-tri faces) ───────────────────────────────
/** Lift a triangle set into an EditMesh: weld coincident positions (so the mesh
 *  is connected — adjacency, mirror, and editing all key off shared verts) and
 *  make one 3-corner face per non-degenerate triangle. `weld` is the position
 *  quantization grid in model units (1e-5 default). The result has NO uv yet —
 *  run `unwrap()` before painting. */
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

/** Convenience: GLB bytes → unwrapped EditMesh, ready for addPart() + painting. */
export function glbToEditMesh(bytes: Uint8Array): EditMesh {
  return unwrap(trianglesToEditMesh(glbToTriangles(bytes)));
}
