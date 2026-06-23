#!/usr/bin/env tools/v8cli

// importPropMesh — bake OBJ/GLB model files into hmsc-int's prop registry.
//
// Run from the repo root:
//   tools/v8cli cart/hmsc-int/tools/importPropMesh.mjs cart/hmsc-int/Desk.glb \
//     --kind imported.desk --label Desk --height 0.8 --color '#9b8066'
//
// This intentionally uses the repo's v8cli host APIs, not Node/Bun/npm.

function die(msg, code = 1) {
  __writeStderr(String(msg) + '\n');
  __exit(code);
}

function usage() {
  die(`usage: tools/v8cli cart/hmsc-int/tools/importPropMesh.mjs <model.obj|model.glb> [options]

options:
  --kind <id>        Prop kind, default imported.<filename>
  --label <text>     Palette label, default title-cased filename
  --height <meters>  Normalize model height, default 1
  --footprint <m>    Override coarse collision radius
  --footprint-width <m>   Override local-X collision width
  --footprint-depth <m>   Override local-Z collision depth
  --color <hex|r,g,b>  Flat mesh color, default #9b8066
  --solid <bool>     Whether it blocks movement, default true
  --cover <hard|soft|none>  Cover class, default hard`, 2);
}

function cleanPath(p) {
  const abs = p.startsWith('/');
  const parts = [];
  for (const part of p.split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') parts.pop();
    else parts.push(part);
  }
  return (abs ? '/' : '') + parts.join('/');
}

function dirname(p) {
  const s = cleanPath(p);
  const at = s.lastIndexOf('/');
  if (at <= 0) return s.startsWith('/') ? '/' : '.';
  return s.slice(0, at);
}

function basename(p, ext = '') {
  const s = cleanPath(p);
  const base = s.slice(s.lastIndexOf('/') + 1);
  return ext && base.endsWith(ext) ? base.slice(0, -ext.length) : base;
}

function extname(p) {
  const b = basename(p);
  const at = b.lastIndexOf('.');
  return at >= 0 ? b.slice(at) : '';
}

function join(...parts) {
  return cleanPath(parts.filter(Boolean).join('/'));
}

function resolvePath(root, p) {
  return p.startsWith('/') ? cleanPath(p) : join(root, p);
}

function findRepoRoot() {
  let root = __cwd();
  while (root !== '/' && !__fs_exists(join(root, 'cart/hmsc-int'))) root = dirname(root);
  if (!__fs_exists(join(root, 'cart/hmsc-int'))) die('run from inside the reactjit repo');
  return root;
}

function relPath(from, to) {
  const a = cleanPath(from).split('/').filter(Boolean);
  const b = cleanPath(to).split('/').filter(Boolean);
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i += 1;
  return [...new Array(a.length - i).fill('..'), ...b.slice(i)].join('/') || '.';
}

const repoRoot = findRepoRoot();
const kindsDir = join(repoRoot, 'cart/hmsc-int/game/kinds');
const dataPath = join(kindsDir, 'importedProps.data.json');
const generatedPath = join(kindsDir, 'importedProps.generated.ts');

function parseArgs(argv) {
  const out = { input: null, opts: {} };
  for (let i = 1; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith('--') && !out.input) {
      out.input = arg;
      continue;
    }
    if (!arg.startsWith('--')) usage();
    const value = argv[i + 1];
    if (value === undefined || value.startsWith('--')) usage();
    out.opts[arg.slice(2)] = value;
    i += 1;
  }
  if (!out.input) usage();
  return out;
}

function slugFromFile(file) {
  const raw = basename(file, extname(file)).toLowerCase();
  return raw.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'mesh';
}

function titleFromSlug(slug) {
  return slug.replace(/[-_.]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function boolArg(value, fallback) {
  if (value === undefined) return fallback;
  if (/^(1|true|yes|y)$/i.test(value)) return true;
  if (/^(0|false|no|n)$/i.test(value)) return false;
  throw new Error(`invalid boolean: ${value}`);
}

function numberArg(value, fallback) {
  if (value === undefined) return fallback;
  const n = Number(value);
  if (!Number.isFinite(n)) throw new Error(`invalid number: ${value}`);
  return n;
}

function parseColor(value) {
  const raw = value ?? '#9b8066';
  const m = /^#?([0-9a-f]{6})$/i.exec(raw.trim());
  if (m) {
    const n = Number.parseInt(m[1], 16);
    return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
  }
  const parts = raw.split(',').map((part) => Number(part.trim()));
  if (parts.length === 3 && parts.every(Number.isFinite)) return parts.map((n) => n > 1 ? n / 255 : n);
  throw new Error(`invalid color: ${value}`);
}

function readText(file) {
  const text = __fs_read(file);
  if (text == null) throw new Error(`cannot read ${file}`);
  return text;
}

const b64chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
function base64ToBytes(value) {
  const out = [];
  let buf = 0;
  let bits = 0;
  for (const ch of value.replace(/\s+/g, '')) {
    if (ch === '=') break;
    const v = b64chars.indexOf(ch);
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

function readBytes(file) {
  const b64 = __fs_read_base64(file);
  if (b64 == null) throw new Error(`cannot read ${file}`);
  return base64ToBytes(b64);
}

function utf8Bytes(str) {
  const out = [];
  for (let i = 0; i < str.length; i += 1) {
    let c = str.charCodeAt(i);
    if (c < 0x80) out.push(c);
    else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 0x3f));
    else if (c >= 0xd800 && c <= 0xdbff) {
      const d = str.charCodeAt(++i);
      c = 0x10000 + ((c & 0x3ff) << 10) + (d & 0x3ff);
      out.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 0x3f), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f));
    } else {
      out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f));
    }
  }
  return new Uint8Array(out);
}

function utf8Decode(bytes) {
  let out = '';
  for (let i = 0; i < bytes.length;) {
    const a = bytes[i++];
    if (a < 0x80) out += String.fromCharCode(a);
    else if (a < 0xe0) out += String.fromCharCode(((a & 0x1f) << 6) | (bytes[i++] & 0x3f));
    else if (a < 0xf0) out += String.fromCharCode(((a & 0x0f) << 12) | ((bytes[i++] & 0x3f) << 6) | (bytes[i++] & 0x3f));
    else {
      const cp = ((a & 0x07) << 18) | ((bytes[i++] & 0x3f) << 12) | ((bytes[i++] & 0x3f) << 6) | (bytes[i++] & 0x3f);
      const u = cp - 0x10000;
      out += String.fromCharCode(0xd800 | (u >> 10), 0xdc00 | (u & 0x3ff));
    }
  }
  return out;
}

function hashHex(bytes, extra) {
  let h = 0xcbf29ce484222325n;
  const prime = 0x100000001b3n;
  const mask = 0xffffffffffffffffn;
  const feed = (b) => { h = ((h ^ BigInt(b)) * prime) & mask; };
  for (const b of bytes) feed(b);
  for (const b of utf8Bytes(extra)) feed(b);
  return h.toString(16).padStart(16, '0');
}

function readData() {
  if (!__fs_exists(dataPath)) return { props: [] };
  const parsed = JSON.parse(readText(dataPath));
  if (!parsed || !Array.isArray(parsed.props)) throw new Error(`${dataPath} must contain { "props": [] }`);
  return parsed;
}

function f(n) {
  if (!Number.isFinite(n)) return '0';
  const rounded = Math.round(n * 1_000_000) / 1_000_000;
  return Object.is(rounded, -0) ? '0' : String(rounded);
}

function v3sub(a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
function v3cross(a, b) {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}
function v3norm(v) {
  const len = Math.hypot(v[0], v[1], v[2]);
  return len > 1e-8 ? [v[0] / len, v[1] / len, v[2] / len] : [0, 1, 0];
}

function emitTri(out, a, b, c) {
  const fallbackNormal = v3norm(v3cross(v3sub(b.position, a.position), v3sub(c.position, a.position)));
  for (const v of [a, b, c]) {
    const p = v.position;
    const n = v.normal ?? fallbackNormal;
    const uv = v.uv ?? [0, 0];
    out.push(p[0], p[1], p[2], n[0], n[1], n[2], uv[0], uv[1]);
  }
}

function parseObj(file) {
  const positions = [];
  const normals = [];
  const uvs = [];
  const vertices = [];
  const resolveIndex = (raw, length) => {
    const n = Number(raw);
    if (!Number.isInteger(n) || n === 0) throw new Error(`bad OBJ index "${raw}"`);
    return n > 0 ? n - 1 : length + n;
  };
  for (const line of readText(file).split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const [op, ...parts] = trimmed.split(/\s+/);
    if (op === 'v') positions.push(parts.slice(0, 3).map(Number));
    else if (op === 'vn') normals.push(v3norm(parts.slice(0, 3).map(Number)));
    else if (op === 'vt') uvs.push(parts.slice(0, 2).map(Number));
    else if (op === 'f') {
      const refs = parts.map((part) => {
        const [v, vt, vn] = part.split('/');
        return {
          position: positions[resolveIndex(v, positions.length)],
          uv: vt ? uvs[resolveIndex(vt, uvs.length)] : null,
          normal: vn ? normals[resolveIndex(vn, normals.length)] : null,
        };
      });
      for (let i = 1; i + 1 < refs.length; i += 1) emitTri(vertices, refs[0], refs[i], refs[i + 1]);
    }
  }
  return vertices;
}

function dataView(bytes) {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}
function u16(bytes, at) { return dataView(bytes).getUint16(at, true); }
function i16(bytes, at) { return dataView(bytes).getInt16(at, true); }
function u32(bytes, at) { return dataView(bytes).getUint32(at, true); }
function f32(bytes, at) { return dataView(bytes).getFloat32(at, true); }
function ascii(bytes, start, end) {
  let out = '';
  for (let i = start; i < end; i += 1) out += String.fromCharCode(bytes[i]);
  return out;
}

function glbChunks(file) {
  const buf = readBytes(file);
  if (ascii(buf, 0, 4) !== 'glTF') throw new Error('not a GLB file');
  if (u32(buf, 4) !== 2) throw new Error('only GLB v2 is supported');
  const length = u32(buf, 8);
  let at = 12;
  let json = null;
  let bin = null;
  while (at + 8 <= length) {
    const chunkLength = u32(buf, at);
    const chunkType = u32(buf, at + 4);
    const data = buf.subarray(at + 8, at + 8 + chunkLength);
    if (chunkType === 0x4e4f534a) json = JSON.parse(utf8Decode(data));
    if (chunkType === 0x004e4942) bin = data;
    at += 8 + chunkLength;
  }
  if (!json || !bin) throw new Error('GLB must contain JSON and BIN chunks');
  return { json, bin, sourceBytes: buf };
}

function mat4Identity() {
  return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
}
function mat4Mul(a, b) {
  const out = new Array(16).fill(0);
  for (let col = 0; col < 4; col += 1) {
    for (let row = 0; row < 4; row += 1) {
      out[col * 4 + row] = a[row] * b[col * 4] + a[4 + row] * b[col * 4 + 1] + a[8 + row] * b[col * 4 + 2] + a[12 + row] * b[col * 4 + 3];
    }
  }
  return out;
}
function mat4FromTrs(node) {
  if (node.matrix) return node.matrix.slice();
  const t = node.translation ?? [0, 0, 0];
  const s = node.scale ?? [1, 1, 1];
  const q = node.rotation ?? [0, 0, 0, 1];
  const [x, y, z, w] = q;
  const xx = x * x, yy = y * y, zz = z * z;
  const xy = x * y, xz = x * z, yz = y * z;
  const wx = w * x, wy = w * y, wz = w * z;
  return [
    (1 - 2 * (yy + zz)) * s[0], (2 * (xy + wz)) * s[0], (2 * (xz - wy)) * s[0], 0,
    (2 * (xy - wz)) * s[1], (1 - 2 * (xx + zz)) * s[1], (2 * (yz + wx)) * s[1], 0,
    (2 * (xz + wy)) * s[2], (2 * (yz - wx)) * s[2], (1 - 2 * (xx + yy)) * s[2], 0,
    t[0], t[1], t[2], 1,
  ];
}
function transformPoint(m, p) {
  return [m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12], m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13], m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14]];
}
function transformNormal(m, n) {
  return v3norm([m[0] * n[0] + m[4] * n[1] + m[8] * n[2], m[1] * n[0] + m[5] * n[1] + m[9] * n[2], m[2] * n[0] + m[6] * n[1] + m[10] * n[2]]);
}

function accessorInfo(json, bin, accessorIndex) {
  const accessor = json.accessors?.[accessorIndex];
  if (!accessor) throw new Error(`missing accessor ${accessorIndex}`);
  const view = json.bufferViews?.[accessor.bufferView];
  if (!view) throw new Error(`missing bufferView ${accessor.bufferView}`);
  const componentBytes = ({ 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 })[accessor.componentType];
  const components = ({ SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 })[accessor.type];
  if (!componentBytes || !components) throw new Error(`unsupported accessor ${accessor.type}/${accessor.componentType}`);
  return {
    accessor,
    offset: (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0),
    stride: view.byteStride ?? componentBytes * components,
    componentBytes,
    components,
    data: bin,
  };
}
function readComponent(data, at, componentType) {
  if (componentType === 5120) return dataView(data).getInt8(at);
  if (componentType === 5121) return data[at];
  if (componentType === 5122) return i16(data, at);
  if (componentType === 5123) return u16(data, at);
  if (componentType === 5125) return u32(data, at);
  if (componentType === 5126) return f32(data, at);
  throw new Error(`unsupported component type ${componentType}`);
}
function readAccessor(json, bin, accessorIndex) {
  const info = accessorInfo(json, bin, accessorIndex);
  const out = [];
  for (let i = 0; i < info.accessor.count; i += 1) {
    const at = info.offset + i * info.stride;
    if (info.components === 1) {
      out.push(readComponent(info.data, at, info.accessor.componentType));
    } else {
      const tuple = [];
      for (let c = 0; c < info.components; c += 1) tuple.push(readComponent(info.data, at + c * info.componentBytes, info.accessor.componentType));
      out.push(tuple);
    }
  }
  return out;
}

function parseGlb(file) {
  const { json, bin } = glbChunks(file);
  const vertices = [];
  const emitPrimitive = (primitive, matrix) => {
    if ((primitive.mode ?? 4) !== 4) throw new Error('only GLB TRIANGLES primitives are supported');
    const positions = readAccessor(json, bin, primitive.attributes.POSITION).map((p) => transformPoint(matrix, p));
    const normals = primitive.attributes.NORMAL === undefined ? null : readAccessor(json, bin, primitive.attributes.NORMAL).map((n) => transformNormal(matrix, n));
    const uvs = primitive.attributes.TEXCOORD_0 === undefined ? null : readAccessor(json, bin, primitive.attributes.TEXCOORD_0);
    const indices = primitive.indices === undefined ? positions.map((_, i) => i) : readAccessor(json, bin, primitive.indices);
    for (let i = 0; i + 2 < indices.length; i += 3) {
      const tri = [indices[i], indices[i + 1], indices[i + 2]].map((idx) => ({ position: positions[idx], normal: normals?.[idx] ?? null, uv: uvs?.[idx] ?? null }));
      emitTri(vertices, tri[0], tri[1], tri[2]);
    }
  };
  const visitNode = (nodeIndex, parent) => {
    const node = json.nodes?.[nodeIndex];
    if (!node) throw new Error(`missing node ${nodeIndex}`);
    const matrix = mat4Mul(parent, mat4FromTrs(node));
    if (node.mesh !== undefined) {
      const mesh = json.meshes?.[node.mesh];
      if (!mesh) throw new Error(`missing mesh ${node.mesh}`);
      for (const primitive of mesh.primitives ?? []) emitPrimitive(primitive, matrix);
    }
    for (const child of node.children ?? []) visitNode(child, matrix);
  };
  const scene = json.scenes?.[json.scene ?? 0];
  if (scene?.nodes?.length) for (const node of scene.nodes) visitNode(node, mat4Identity());
  else for (const mesh of json.meshes ?? []) for (const primitive of mesh.primitives ?? []) emitPrimitive(primitive, mat4Identity());
  return vertices;
}

function loadMesh(file) {
  const ext = extname(file).toLowerCase();
  if (ext === '.obj') return parseObj(file);
  if (ext === '.glb') return parseGlb(file);
  throw new Error(`unsupported model format "${ext}" (expected .obj or .glb)`);
}

function normalizeMesh(raw, targetHeight) {
  if (raw.length < 24) throw new Error('mesh has no triangles');
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (let i = 0; i < raw.length; i += 8) {
    const x = raw[i], y = raw[i + 1], z = raw[i + 2];
    minX = Math.min(minX, x); minY = Math.min(minY, y); minZ = Math.min(minZ, z);
    maxX = Math.max(maxX, x); maxY = Math.max(maxY, y); maxZ = Math.max(maxZ, z);
  }
  const height = maxY - minY;
  const scale = targetHeight > 0 && height > 1e-6 ? targetHeight / height : 1;
  const centerX = (minX + maxX) / 2;
  const centerZ = (minZ + maxZ) / 2;
  const out = new Float32Array(raw.length);
  let footprint = 0;
  let boundsRadius = 0;
  let finalHeight = 0;
  let finalMinX = Infinity, finalMaxX = -Infinity;
  let finalMinZ = Infinity, finalMaxZ = -Infinity;
  for (let i = 0; i < raw.length; i += 8) {
    const x = (raw[i] - centerX) * scale;
    const y = (raw[i + 1] - minY) * scale;
    const z = (raw[i + 2] - centerZ) * scale;
    out[i] = x; out[i + 1] = y; out[i + 2] = z;
    out[i + 3] = raw[i + 3]; out[i + 4] = raw[i + 4]; out[i + 5] = raw[i + 5];
    out[i + 6] = raw[i + 6]; out[i + 7] = raw[i + 7];
    footprint = Math.max(footprint, Math.hypot(x, z));
    boundsRadius = Math.max(boundsRadius, Math.hypot(x, y, z));
    finalHeight = Math.max(finalHeight, y);
    finalMinX = Math.min(finalMinX, x); finalMaxX = Math.max(finalMaxX, x);
    finalMinZ = Math.min(finalMinZ, z); finalMaxZ = Math.max(finalMaxZ, z);
  }
  return {
    vertices: out,
    count: out.length / 8,
    footprint,
    footprintWidth: finalMaxX - finalMinX,
    footprintDepth: finalMaxZ - finalMinZ,
    boundsRadius,
    height: finalHeight,
  };
}

function buildEntry(entry) {
  const abs = resolvePath(repoRoot, entry.source);
  const sourceBytes = readBytes(abs);
  const raw = loadMesh(abs);
  const mesh = normalizeMesh(raw, entry.heightMeters ?? 1);
  const color = entry.color ?? [0.607843, 0.501961, 0.4];
  const hash = hashHex(sourceBytes, JSON.stringify({ kind: entry.kind, heightMeters: entry.heightMeters ?? 1, color, source: entry.source }));
  return {
    ...entry,
    color,
    heightMeters: mesh.height,
    footprintRadiusMeters: entry.footprintRadiusMeters ?? Math.max(0.1, mesh.footprint),
    footprintWidthMeters: entry.footprintWidthMeters ?? Math.max(0.1, mesh.footprintWidth),
    footprintDepthMeters: entry.footprintDepthMeters ?? Math.max(0.1, mesh.footprintDepth),
    meshKey: `${entry.kind}:${hash}`,
    boundsRadius: mesh.boundsRadius,
    count: mesh.count,
    vertices: mesh.vertices,
  };
}

function tsString(value) {
  return JSON.stringify(value);
}

function emitGenerated(entries) {
  const kinds = entries.map((entry) => entry.kind);
  const defs = entries.map((entry) => `  ${tsString(entry.kind)}: {
    kind: ${tsString(entry.kind)},
    label: ${tsString(entry.label)},
    solid: ${entry.solid ? 'true' : 'false'},
    footprintRadiusMeters: ${f(entry.footprintRadiusMeters)},
    footprintWidthMeters: ${f(entry.footprintWidthMeters)},
    footprintDepthMeters: ${f(entry.footprintDepthMeters)},
    heightMeters: ${f(entry.heightMeters)},
    tileKind: 'wall',
    trafficControl: 'none',
    coverClass: ${tsString(entry.coverClass ?? 'hard')},
  },`).join('\n');
  const meshes = entries.map((entry) => {
    const floats = Array.from(entry.vertices, f).join(', ');
    return `  ${tsString(entry.kind)}: {
    key: ${tsString(entry.meshKey)},
    source: ${tsString(entry.source)},
    color: [${entry.color.map(f).join(', ')}],
    count: ${entry.count},
    boundsRadius: ${f(entry.boundsRadius)},
    footprintWidthMeters: ${f(entry.footprintWidthMeters)},
    footprintDepthMeters: ${f(entry.footprintDepthMeters)},
    heightMeters: ${f(entry.heightMeters)},
    solid: ${entry.solid ? 'true' : 'false'},
    vertices: new Float32Array([${floats}]),
  },`;
  }).join('\n');
  return `// Generated by cart/hmsc-int/tools/importPropMesh.mjs.
// Edit importedProps.data.json or rerun the importer; do not hand-edit mesh data here.

export const IMPORTED_PROP_KINDS = [${kinds.map(tsString).join(', ')}] as const;
export type ImportedPropKind = typeof IMPORTED_PROP_KINDS[number];

export type ImportedPropDefinition = {
  kind: ImportedPropKind;
  label: string;
  solid: boolean;
  footprintRadiusMeters: number;
  footprintWidthMeters?: number;
  footprintDepthMeters?: number;
  heightMeters: number;
  tileKind: 'wall';
  trafficControl: 'none';
  coverClass: 'hard' | 'soft' | 'none';
};

export type ImportedPropMesh = {
  key: string;
  source: string;
  color: readonly [number, number, number];
  count: number;
  boundsRadius: number;
  footprintWidthMeters: number;
  footprintDepthMeters: number;
  heightMeters: number;
  solid: boolean;
  vertices: Float32Array;
};

export const IMPORTED_PROP_DEFINITIONS = {
${defs}
} satisfies Record<ImportedPropKind, ImportedPropDefinition>;

export const IMPORTED_PROP_MESHES = {
${meshes}
} satisfies Record<ImportedPropKind, ImportedPropMesh>;
`;
}

function main() {
  const { input, opts } = parseArgs(process.argv);
  const inputAbs = resolvePath(repoRoot, input);
  if (!__fs_exists(inputAbs)) throw new Error(`missing input file: ${input}`);
  const slug = slugFromFile(inputAbs);
  const kind = opts.kind ?? `imported.${slug}`;
  if (!/^imported\.[a-zA-Z0-9_.-]+$/.test(kind)) throw new Error('kind must look like imported.name');
  const coverClass = opts.cover ?? 'hard';
  if (!['hard', 'soft', 'none'].includes(coverClass)) throw new Error('--cover must be hard, soft, or none');

  const data = readData();
  const source = relPath(repoRoot, inputAbs);
  const next = {
    kind,
    label: opts.label ?? titleFromSlug(slug),
    source,
    heightMeters: numberArg(opts.height, 1),
    color: parseColor(opts.color),
    solid: boolArg(opts.solid, true),
    coverClass,
  };
  const footprint = numberArg(opts.footprint, null);
  if (footprint !== null) next.footprintRadiusMeters = footprint;
  const footprintWidth = numberArg(opts['footprint-width'], null);
  if (footprintWidth !== null) next.footprintWidthMeters = footprintWidth;
  const footprintDepth = numberArg(opts['footprint-depth'], null);
  if (footprintDepth !== null) next.footprintDepthMeters = footprintDepth;

  const existing = data.props.findIndex((entry) => entry.kind === kind);
  if (existing >= 0) data.props[existing] = { ...data.props[existing], ...next };
  else data.props.push(next);
  const merged = data.props[existing >= 0 ? existing : data.props.length - 1];
  if (opts.footprint === undefined) delete merged.footprintRadiusMeters;
  if (opts['footprint-width'] === undefined) delete merged.footprintWidthMeters;
  if (opts['footprint-depth'] === undefined) delete merged.footprintDepthMeters;
  data.props.sort((a, b) => a.kind.localeCompare(b.kind));

  const built = data.props.map(buildEntry);
  for (let i = 0; i < data.props.length; i += 1) {
    data.props[i].heightMeters = Number(f(built[i].heightMeters));
    data.props[i].footprintRadiusMeters = Number(f(built[i].footprintRadiusMeters));
    data.props[i].footprintWidthMeters = Number(f(built[i].footprintWidthMeters));
    data.props[i].footprintDepthMeters = Number(f(built[i].footprintDepthMeters));
  }
  __fs_mkdir(kindsDir);
  if (!__fs_write(dataPath, `${JSON.stringify(data, null, 2)}\n`)) throw new Error(`failed to write ${dataPath}`);
  if (!__fs_write(generatedPath, emitGenerated(built))) throw new Error(`failed to write ${generatedPath}`);

  const imported = built.find((entry) => entry.kind === kind);
  __writeStdout(`imported ${kind}: ${imported.count} vertices, height ${f(imported.heightMeters)}m, footprint ${f(imported.footprintWidthMeters)}x${f(imported.footprintDepthMeters)}m\n`);
  __writeStdout(`updated ${relPath(repoRoot, dataPath)} and ${relPath(repoRoot, generatedPath)}\n`);
}

try {
  main();
} catch (err) {
  die(err && err.message ? err.message : err);
}
