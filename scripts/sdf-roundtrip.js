// sdf-roundtrip.js — Stage 0 of the SDF-skeleton decision spike (USER ASK req_2604).
//
// THE QUESTION we are answering: if we represent an arbitrary imported model as a
// signed-distance FIELD (so we could later animate it by bones alone, never
// splitting a quad), how much of the model's character survives the round-trip —
// and at what grid resolution? This bakes exactly that round-trip so we can LOOK:
//
//   model file (.glb/.obj) ─→ triangles ─→ SIGNED voxel grid (mesh→SDF)
//        ─→ surface nets ─→ re-meshed OBJ   (one per grid resolution)
//
// The lab cart (cart/sdf_roundtrip_lab.tsx) loads the ORIGINAL beside each bake so
// you can A/B them at one camera. If the field can't hold the model standing still,
// path A (surface-is-the-field) is dead and we commit to path B; if it holds, A is
// live and worth the animation test. This is an offline artifact bake — same
// category as scripts/nug-gen.js — NOT frame-loop logic. If the technique wins, the
// runtime deform path graduates to Zig (framework/skeleton/).
//
// Run:  tools/v8cli scripts/sdf-roundtrip.js <model-path> [--grid 64,128,256] [--name NAME]
//   e.g. tools/v8cli scripts/sdf-roundtrip.js cart/hmsc-int/car.obj --grid 64,128
// Output: cart/editor/data/models/roundtrip/<name>/<name>_<N>.obj  (+ a manifest.json
//         listing the original path and the per-resolution bakes for the lab).

'use strict';

const out = (s) => __writeStdout(s + '\n');
const err = (s) => __writeStderr(s + '\n');
const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));

// ── file reading (base64 for binary GLB; __fs_read is string-typed) ──────────────

function readBytes(path) {
  const b64 = __fs_read_base64(path);
  if (b64 == null) return null;
  // Self-contained base64 decode → Uint8Array (no dependency on atob under v8cli).
  const LUT = new Int16Array(256).fill(-1);
  const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  for (let i = 0; i < A.length; i++) LUT[A.charCodeAt(i)] = i;
  let len = b64.length;
  while (len > 0 && (b64[len - 1] === '=' || b64[len - 1] === '\n')) len--;
  const outLen = (len * 3) >> 2;
  const bytes = new Uint8Array(outLen);
  let o = 0, acc = 0, nb = 0;
  for (let i = 0; i < len; i++) {
    const v = LUT[b64.charCodeAt(i)];
    if (v < 0) continue;
    acc = (acc << 6) | v; nb += 6;
    if (nb >= 8) { nb -= 8; bytes[o++] = (acc >> nb) & 0xff; }
  }
  return bytes.subarray(0, o);
}

// ── mesh loading → a flat triangle-position stream [ax,ay,az, bx,by,bz, cx,cy,cz] ─

function loadObj(text) {
  const pos = [];
  const tris = [];
  const lines = text.split('\n');
  for (const line of lines) {
    if (line.charCodeAt(0) === 118 /* v */ && line.charCodeAt(1) === 32) {
      const p = line.split(/\s+/);
      pos.push(+p[1], +p[2], +p[3]); // ignore trailing rgb if present
    } else if (line.charCodeAt(0) === 102 /* f */ && line.charCodeAt(1) === 32) {
      const p = line.trim().split(/\s+/);
      // fan-triangulate; each token is v or v/vt/vn or v//vn (1-based, may be negative)
      const idx = [];
      for (let i = 1; i < p.length; i++) {
        let vi = parseInt(p[i].split('/')[0], 10);
        if (vi < 0) vi = pos.length / 3 + vi; else vi -= 1;
        idx.push(vi);
      }
      for (let i = 1; i < idx.length - 1; i++) tris.push(idx[0], idx[i], idx[i + 1]);
    }
  }
  return emit(pos, tris);
}

// Minimal glTF/GLB v2 reader: POSITION + indices per primitive, node world transforms
// applied so instanced/rotated meshes land where they belong. Skinned meshes come out
// in bind pose (we ignore joints) — fine for a static round-trip.
function loadGlb(bytes) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (dv.getUint32(0, true) !== 0x46546c67) throw new Error('not a GLB (bad magic)');
  let off = 12, jsonText = null, bin = null;
  while (off < bytes.byteLength) {
    const clen = dv.getUint32(off, true);
    const ctype = dv.getUint32(off + 4, true);
    const cstart = off + 8;
    if (ctype === 0x4e4f534a) jsonText = utf8(bytes.subarray(cstart, cstart + clen));
    else if (ctype === 0x004e4942) bin = bytes.subarray(cstart, cstart + clen);
    off = cstart + clen + ((clen % 4) ? 4 - (clen % 4) : 0);
  }
  const g = JSON.parse(jsonText);
  const COMP = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 };
  const NCOMP = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };

  function accessor(ai) {
    const a = g.accessors[ai];
    const bv = g.bufferViews[a.bufferView];
    const base = (bv.byteOffset || 0) + (a.byteOffset || 0);
    const n = a.count, nc = NCOMP[a.type], cs = COMP[a.componentType];
    const stride = bv.byteStride || nc * cs;
    const dvw = new DataView(bin.buffer, bin.byteOffset, bin.byteLength);
    const read = (o) => {
      switch (a.componentType) {
        case 5126: return dvw.getFloat32(o, true);
        case 5125: return dvw.getUint32(o, true);
        case 5123: return dvw.getUint16(o, true);
        case 5121: return dvw.getUint8(o);
        case 5122: return dvw.getInt16(o, true);
        case 5120: return dvw.getInt8(o);
        default: return 0;
      }
    };
    const arr = new Float64Array(n * nc);
    for (let i = 0; i < n; i++)
      for (let c = 0; c < nc; c++) arr[i * nc + c] = read(base + i * stride + c * cs);
    return { arr, nc, count: n };
  }

  // node → world matrix (column-major mat4), composed down the scene graph.
  function nodeLocal(node) {
    if (node.matrix) return node.matrix.slice();
    const t = node.translation || [0, 0, 0];
    const q = node.rotation || [0, 0, 0, 1];
    const s = node.scale || [1, 1, 1];
    const x = q[0], y = q[1], z = q[2], w = q[3];
    const x2 = x + x, y2 = y + y, z2 = z + z;
    const xx = x * x2, xy = x * y2, xz = x * z2;
    const yy = y * y2, yz = y * z2, zz = z * z2;
    const wx = w * x2, wy = w * y2, wz = w * z2;
    return [
      (1 - (yy + zz)) * s[0], (xy + wz) * s[0], (xz - wy) * s[0], 0,
      (xy - wz) * s[1], (1 - (xx + zz)) * s[1], (yz + wx) * s[1], 0,
      (xz + wy) * s[2], (yz - wx) * s[2], (1 - (xx + yy)) * s[2], 0,
      t[0], t[1], t[2], 1,
    ];
  }
  function mul(a, b) { // a*b, column-major
    const r = new Array(16);
    for (let c = 0; c < 4; c++) for (let rr = 0; rr < 4; rr++) {
      let sum = 0;
      for (let k = 0; k < 4; k++) sum += a[k * 4 + rr] * b[c * 4 + k];
      r[c * 4 + rr] = sum;
    }
    return r;
  }
  const apply = (m, px, py, pz) => [
    m[0] * px + m[4] * py + m[8] * pz + m[12],
    m[1] * px + m[5] * py + m[9] * pz + m[13],
    m[2] * px + m[6] * py + m[10] * pz + m[14],
  ];

  const pos = [];
  const tris = [];
  function emitMesh(meshIdx, world) {
    const mesh = g.meshes[meshIdx];
    for (const prim of mesh.primitives) {
      if (prim.mode !== undefined && prim.mode !== 4) continue; // triangles only
      if (prim.attributes.POSITION === undefined) continue;
      const P = accessor(prim.attributes.POSITION);
      const base = pos.length / 3;
      for (let i = 0; i < P.count; i++) {
        const w = apply(world, P.arr[i * 3], P.arr[i * 3 + 1], P.arr[i * 3 + 2]);
        pos.push(w[0], w[1], w[2]);
      }
      if (prim.indices !== undefined) {
        const I = accessor(prim.indices);
        for (let i = 0; i + 2 < I.count; i += 3)
          tris.push(base + I.arr[i], base + I.arr[i + 1], base + I.arr[i + 2]);
      } else {
        for (let i = 0; i + 2 < P.count; i += 3) tris.push(base + i, base + i + 1, base + i + 2);
      }
    }
  }
  function walk(nodeIdx, parent) {
    const node = g.nodes[nodeIdx];
    const world = mul(parent, nodeLocal(node));
    if (node.mesh !== undefined) emitMesh(node.mesh, world);
    if (node.children) for (const c of node.children) walk(c, world);
  }
  const ID = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  const scene = g.scenes ? g.scenes[g.scene || 0] : null;
  if (scene && scene.nodes) for (const n of scene.nodes) walk(n, ID);
  else for (let i = 0; i < g.meshes.length; i++) emitMesh(i, ID); // no scene graph
  return emit(pos, tris);
}

function utf8(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length;) {
    const b = bytes[i++];
    if (b < 0x80) s += String.fromCharCode(b);
    else if (b < 0xe0) s += String.fromCharCode(((b & 31) << 6) | (bytes[i++] & 63));
    else if (b < 0xf0) s += String.fromCharCode(((b & 15) << 12) | ((bytes[i++] & 63) << 6) | (bytes[i++] & 63));
    else { const cp = ((b & 7) << 18) | ((bytes[i++] & 63) << 12) | ((bytes[i++] & 63) << 6) | (bytes[i++] & 63); s += String.fromCodePoint(cp); }
  }
  return s;
}

// Pack an indexed (pos, tris) into a flat per-triangle vertex stream + bounds.
function emit(pos, tris) {
  const T = tris.length / 3;
  const v = new Float64Array(T * 9);
  let mnx = Infinity, mny = Infinity, mnz = Infinity, mxx = -Infinity, mxy = -Infinity, mxz = -Infinity;
  for (let t = 0; t < T; t++) {
    for (let c = 0; c < 3; c++) {
      const p = tris[t * 3 + c] * 3;
      const x = pos[p], y = pos[p + 1], z = pos[p + 2];
      v[t * 9 + c * 3] = x; v[t * 9 + c * 3 + 1] = y; v[t * 9 + c * 3 + 2] = z;
      if (x < mnx) mnx = x; if (y < mny) mny = y; if (z < mnz) mnz = z;
      if (x > mxx) mxx = x; if (y > mxy) mxy = y; if (z > mxz) mxz = z;
    }
  }
  return { tris: v, triCount: T, bounds: [mnx, mny, mnz, mxx, mxy, mxz] };
}

// ── point→triangle closest distance (squared), Ericson RTCD ─────────────────────

function pointTriDist2(px, py, pz, ax, ay, az, bx, by, bz, cx, cy, cz) {
  const abx = bx - ax, aby = by - ay, abz = bz - az;
  const acx = cx - ax, acy = cy - ay, acz = cz - az;
  const apx = px - ax, apy = py - ay, apz = pz - az;
  const d1 = abx * apx + aby * apy + abz * apz;
  const d2 = acx * apx + acy * apy + acz * apz;
  if (d1 <= 0 && d2 <= 0) return apx * apx + apy * apy + apz * apz;
  const bpx = px - bx, bpy = py - by, bpz = pz - bz;
  const d3 = abx * bpx + aby * bpy + abz * bpz;
  const d4 = acx * bpx + acy * bpy + acz * bpz;
  if (d3 >= 0 && d4 <= d3) return bpx * bpx + bpy * bpy + bpz * bpz;
  const vc = d1 * d4 - d3 * d2;
  if (vc <= 0 && d1 >= 0 && d3 <= 0) {
    const w = d1 / (d1 - d3);
    const qx = apx - w * abx, qy = apy - w * aby, qz = apz - w * abz;
    return qx * qx + qy * qy + qz * qz;
  }
  const cpx = px - cx, cpy = py - cy, cpz = pz - cz;
  const d5 = abx * cpx + aby * cpy + abz * cpz;
  const d6 = acx * cpx + acy * cpy + acz * cpz;
  if (d6 >= 0 && d5 <= d6) return cpx * cpx + cpy * cpy + cpz * cpz;
  const vb = d5 * d2 - d1 * d6;
  if (vb <= 0 && d2 >= 0 && d6 <= 0) {
    const w = d2 / (d2 - d6);
    const qx = apx - w * acx, qy = apy - w * acy, qz = apz - w * acz;
    return qx * qx + qy * qy + qz * qz;
  }
  const va = d3 * d6 - d5 * d4;
  if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) {
    const w = (d4 - d3) / ((d4 - d3) + (d5 - d6));
    const qx = bpx + w * (cx - bx), qy = bpy + w * (cy - by), qz = bpz + w * (cz - bz);
    return qx * qx + qy * qy + qz * qz;
  }
  const denom = 1 / (va + vb + vc);
  const w2 = vb * denom, w3 = vc * denom;
  const qx = apx + w2 * abx + w3 * acx, qy = apy + w2 * aby + w3 * acy, qz = apz + w2 * abz + w3 * acz;
  return qx * qx + qy * qy + qz * qz;
}

// ── mesh → signed grid: narrow-band exact distance + flood-fill sign ─────────────
//
// Exact unsigned distance within BAND cells of the surface; sign from a flood fill
// that starts OUTSIDE (the grid border) and can only pass through cells more than a
// cell from the surface. Reached ⇒ outside (+); walled-off ⇒ inside (−). A thin
// shell's outer layer (has an outside neighbor) is +, its inner layer −, so the zero
// crossing lands in the wall. Non-watertight holes just let the flood in — the
// cavity reads as outside, which is what we want. Sub-voxel gaps that the flood
// can't thread (fingers at low res) web together: that IS the resolution signal.
function meshToGrid(mesh, R, N) {
  const M = N + 1;
  const cell = (2 * R) / N;
  const inv = 1 / cell;
  const BAND = 2;
  const M3 = M * M * M;
  const u = new Float32Array(M3).fill(Infinity); // unsigned distance in band
  const near = new Int32Array(M3).fill(-1);      // nearest source triangle per band point
  const tv = mesh.tris;
  const T = mesh.triCount;
  const idx = (i, j, k) => (k * M + j) * M + i;

  // per-triangle unit normals (source mesh assumed consistently wound)
  const nrm = new Float32Array(T * 3);
  for (let t = 0; t < T; t++) {
    const o = t * 9;
    const ex = tv[o + 3] - tv[o], ey = tv[o + 4] - tv[o + 1], ez = tv[o + 5] - tv[o + 2];
    const fx = tv[o + 6] - tv[o], fy = tv[o + 7] - tv[o + 1], fz = tv[o + 8] - tv[o + 2];
    let nx = ey * fz - ez * fy, ny = ez * fx - ex * fz, nz = ex * fy - ey * fx;
    const l = Math.hypot(nx, ny, nz) || 1;
    nrm[t * 3] = nx / l; nrm[t * 3 + 1] = ny / l; nrm[t * 3 + 2] = nz / l;
  }

  for (let t = 0; t < T; t++) {
    const o = t * 9;
    const ax = tv[o], ay = tv[o + 1], az = tv[o + 2];
    const bx = tv[o + 3], by = tv[o + 4], bz = tv[o + 5];
    const cx = tv[o + 6], cy = tv[o + 7], cz = tv[o + 8];
    // grid-index AABB of the triangle, padded by BAND.
    let i0 = Math.floor((Math.min(ax, bx, cx) + R) * inv) - BAND;
    let j0 = Math.floor((Math.min(ay, by, cy) + R) * inv) - BAND;
    let k0 = Math.floor((Math.min(az, bz, cz) + R) * inv) - BAND;
    let i1 = Math.ceil((Math.max(ax, bx, cx) + R) * inv) + BAND;
    let j1 = Math.ceil((Math.max(ay, by, cy) + R) * inv) + BAND;
    let k1 = Math.ceil((Math.max(az, bz, cz) + R) * inv) + BAND;
    if (i0 < 0) i0 = 0; if (j0 < 0) j0 = 0; if (k0 < 0) k0 = 0;
    if (i1 > M - 1) i1 = M - 1; if (j1 > M - 1) j1 = M - 1; if (k1 > M - 1) k1 = M - 1;
    for (let k = k0; k <= k1; k++) {
      const pz = -R + k * cell;
      for (let j = j0; j <= j1; j++) {
        const py = -R + j * cell;
        for (let i = i0; i <= i1; i++) {
          const px = -R + i * cell;
          const d2 = pointTriDist2(px, py, pz, ax, ay, az, bx, by, bz, cx, cy, cz);
          const p = idx(i, j, k);
          if (d2 < u[p] * u[p]) { u[p] = Math.sqrt(d2); near[p] = t; }
        }
      }
    }
  }

  // Sign the band by the nearest triangle's pseudonormal: which side of that face the
  // point sits on. This is LOCAL geometry, so it stays consistent at every resolution —
  // the fix for the old flood/neighbor heuristic whose winding errors GREW with the grid
  // (64³ solid, but 128³/256³ full of culled holes because misclassified cells inverted
  // the surface). Face-normal sign is exact for face-interior closest points and right
  // for the vast majority elsewhere.
  const g = new Float32Array(M3);
  for (let k = 0; k < M; k++) {
    const pz = -R + k * cell;
    for (let j = 0; j < M; j++) {
      const py = -R + j * cell;
      for (let i = 0; i < M; i++) {
        const px = -R + i * cell;
        const p = idx(i, j, k);
        const t = near[p];
        if (t < 0) continue; // far point — resolved by the flood below
        const o = t * 9, no = t * 3;
        const sd = (px - tv[o]) * nrm[no] + (py - tv[o + 1]) * nrm[no + 1] + (pz - tv[o + 2]) * nrm[no + 2];
        g[p] = sd < 0 ? -u[p] : u[p];
      }
    }
  }

  // Far field (no nearby triangle): flood from the grid border through far cells only
  // (band cells are walls). Reached ⇒ exterior (+); enclosed ⇒ interior (−). A real hole
  // (non-watertight mouth/eye) lets the flood into the cavity — it reads as exterior,
  // which is what we want.
  const BIG = R * 4;
  const reached = new Uint8Array(M3);
  const stack = new Int32Array(M3);
  let sp = 0;
  const seed = (p) => { if (near[p] < 0 && !reached[p]) { reached[p] = 1; stack[sp++] = p; } };
  for (let k = 0; k < M; k++)
    for (let j = 0; j < M; j++)
      for (let i = 0; i < M; i++) {
        if (i !== 0 && i !== M - 1 && j !== 0 && j !== M - 1 && k !== 0 && k !== M - 1) continue;
        seed(idx(i, j, k));
      }
  while (sp > 0) {
    const p = stack[--sp];
    const i = p % M, j = ((p / M) | 0) % M, k = (p / (M * M)) | 0;
    if (i > 0) seed(p - 1); if (i < M - 1) seed(p + 1);
    if (j > 0) seed(p - M); if (j < M - 1) seed(p + M);
    if (k > 0) seed(p - M * M); if (k < M - 1) seed(p + M * M);
  }
  for (let p = 0; p < M3; p++) if (near[p] < 0) g[p] = reached[p] ? BIG : -BIG;

  return { g, M, cell, R };
}

// ── surface nets — extraction reused from scripts/nug-gen.js:235 ────────────────
// DUPLICATION NOTE: this is a verbatim lift of nug-gen.js's surfaceNets. v8cli has
// no module story for scripts, and refactoring the working generator mid-spike is a
// needless risk. If the SDF-skeleton technique graduates, the mesher moves to Zig
// (framework/) and supersedes both copies — see the header. Until then, keep them
// in sync by hand.
function surfaceNets(field, R, N) {
  const M = N + 1;
  const cell = (2 * R) / N;
  const at = (i) => -R + i * cell;
  const grid = new Float32Array(M * M * M);
  for (let k = 0; k < M; k++)
    for (let j = 0; j < M; j++)
      for (let i = 0; i < M; i++)
        grid[(k * M + j) * M + i] = field(at(i), at(j), at(k));
  const cellVert = new Int32Array(N * N * N).fill(-1);
  const verts = [];
  const EDGES = [];
  for (let a = 0; a < 8; a++)
    for (let b = a + 1; b < 8; b++)
      if (((a ^ b) & ((a ^ b) - 1)) === 0) EDGES.push([a, b]);
  const CX = [0, 1, 0, 1, 0, 1, 0, 1], CY = [0, 0, 1, 1, 0, 0, 1, 1], CZ = [0, 0, 0, 0, 1, 1, 1, 1];
  for (let k = 0; k < N; k++)
    for (let j = 0; j < N; j++)
      for (let i = 0; i < N; i++) {
        const s = new Float64Array(8);
        let inside = 0;
        for (let c = 0; c < 8; c++) {
          s[c] = grid[((k + CZ[c]) * M + (j + CY[c])) * M + (i + CX[c])];
          if (s[c] < 0) inside++;
        }
        if (inside === 0 || inside === 8) continue;
        let sx = 0, sy = 0, sz = 0, cnt = 0;
        for (const [a, b] of EDGES) {
          if ((s[a] < 0) === (s[b] < 0)) continue;
          const t = s[a] / (s[a] - s[b]);
          sx += CX[a] + (CX[b] - CX[a]) * t;
          sy += CY[a] + (CY[b] - CY[a]) * t;
          sz += CZ[a] + (CZ[b] - CZ[a]) * t;
          cnt++;
        }
        cellVert[(k * N + j) * N + i] = verts.length / 3;
        verts.push(at(i) + (sx / cnt) * cell, at(j) + (sy / cnt) * cell, at(k) + (sz / cnt) * cell);
      }
  const tris = [];
  const gv = (i, j, k) => grid[(k * M + j) * M + i];
  const cv = (i, j, k) => cellVert[(k * N + j) * N + i];
  const quad = (a, b, c, d, flip) => {
    if (a < 0 || b < 0 || c < 0 || d < 0) return;
    if (flip) tris.push(a, b, c, a, c, d);
    else tris.push(a, d, c, a, c, b);
  };
  for (let k = 1; k < N; k++)
    for (let j = 1; j < N; j++)
      for (let i = 1; i < N; i++) {
        const s0 = gv(i, j, k);
        const ex = gv(i + 1, j, k), ey = gv(i, j + 1, k), ez = gv(i, j, k + 1);
        if ((s0 < 0) !== (ex < 0)) quad(cv(i, j - 1, k - 1), cv(i, j, k - 1), cv(i, j, k), cv(i, j - 1, k), s0 < 0);
        if ((s0 < 0) !== (ey < 0)) quad(cv(i - 1, j, k - 1), cv(i - 1, j, k), cv(i, j, k), cv(i, j, k - 1), s0 < 0);
        if ((s0 < 0) !== (ez < 0)) quad(cv(i - 1, j - 1, k), cv(i, j - 1, k), cv(i, j, k), cv(i - 1, j, k), s0 < 0);
      }
  return { verts, tris };
}

// trilinear sampler over the signed grid — exact at lattice points.
function makeSampler(G) {
  const { g, M, cell, R } = G;
  return (x, y, z) => {
    let fi = (x + R) / cell, fj = (y + R) / cell, fk = (z + R) / cell;
    if (fi < 0) fi = 0; if (fi > M - 1.001) fi = M - 1.001;
    if (fj < 0) fj = 0; if (fj > M - 1.001) fj = M - 1.001;
    if (fk < 0) fk = 0; if (fk > M - 1.001) fk = M - 1.001;
    const i0 = fi | 0, j0 = fj | 0, k0 = fk | 0;
    const tx = fi - i0, ty = fj - j0, tz = fk - k0;
    const at = (i, j, k) => g[(k * M + j) * M + i];
    const c00 = at(i0, j0, k0) * (1 - tx) + at(i0 + 1, j0, k0) * tx;
    const c10 = at(i0, j0 + 1, k0) * (1 - tx) + at(i0 + 1, j0 + 1, k0) * tx;
    const c01 = at(i0, j0, k0 + 1) * (1 - tx) + at(i0 + 1, j0, k0 + 1) * tx;
    const c11 = at(i0, j0 + 1, k0 + 1) * (1 - tx) + at(i0 + 1, j0 + 1, k0 + 1) * tx;
    const c0 = c00 * (1 - ty) + c10 * ty, c1 = c01 * (1 - ty) + c11 * ty;
    return c0 * (1 - tz) + c1 * tz;
  };
}

// ── OBJ writer (v/vn/f, matches nug-gen's viewer-ready format) ──────────────────

function writeObj(path, verts, tris, normals, header) {
  let s = header + '\n';
  for (let i = 0; i < verts.length; i += 3)
    s += 'v ' + verts[i].toFixed(4) + ' ' + verts[i + 1].toFixed(4) + ' ' + verts[i + 2].toFixed(4) + '\n';
  for (let i = 0; i < normals.length; i += 3)
    s += 'vn ' + normals[i].toFixed(3) + ' ' + normals[i + 1].toFixed(3) + ' ' + normals[i + 2].toFixed(3) + '\n';
  for (let i = 0; i < tris.length; i += 3) {
    const a = tris[i] + 1, b = tris[i + 1] + 1, c = tris[i + 2] + 1;
    s += 'f ' + a + '//' + a + ' ' + b + '//' + b + ' ' + c + '//' + c + '\n';
  }
  return __fs_write(path, s);
}

// ── main ─────────────────────────────────────────────────────────────────────────

// ── QEM decimation (Garland–Heckbert quadric edge-collapse) ─────────────────────
// The point of "bake high, then decimate": a quadric decimator removes triangles from
// FLAT regions first and PROTECTS high-curvature detail (fingers, face), so you land at
// a low triangle budget that still carries the detail a raw low-res grid never sampled.
// In place inputs (verts flat, tris flat indices); returns a fresh compacted mesh.
function decimate(vertsArr, trisArr, target) {
  const nv = vertsArr.length / 3;
  const px = new Float64Array(nv), py = new Float64Array(nv), pz = new Float64Array(nv);
  for (let i = 0; i < nv; i++) { px[i] = vertsArr[i * 3]; py[i] = vertsArr[i * 3 + 1]; pz[i] = vertsArr[i * 3 + 2]; }
  const Q = new Float64Array(nv * 10);       // per-vertex 4×4 quadric (10 unique)
  const alive = new Uint8Array(nv).fill(1);
  const ver = new Int32Array(nv);            // version stamp for lazy heap invalidation
  const nf0 = trisArr.length / 3;
  const fa = new Int32Array(nf0), fb = new Int32Array(nf0), fc = new Int32Array(nf0), fv = new Uint8Array(nf0).fill(1);
  for (let i = 0; i < nf0; i++) { fa[i] = trisArr[i * 3]; fb[i] = trisArr[i * 3 + 1]; fc[i] = trisArr[i * 3 + 2]; }
  const vf = Array.from({ length: nv }, () => new Set());

  const addQ = (v, a, b, c, d) => {
    const o = v * 10;
    Q[o] += a * a; Q[o + 1] += a * b; Q[o + 2] += a * c; Q[o + 3] += a * d;
    Q[o + 4] += b * b; Q[o + 5] += b * c; Q[o + 6] += b * d;
    Q[o + 7] += c * c; Q[o + 8] += c * d; Q[o + 9] += d * d;
  };
  for (let i = 0; i < nf0; i++) {
    const a = fa[i], b = fb[i], c = fc[i];
    vf[a].add(i); vf[b].add(i); vf[c].add(i);
    const ux = px[b] - px[a], uy = py[b] - py[a], uz = pz[b] - pz[a];
    const wx = px[c] - px[a], wy = py[c] - py[a], wz = pz[c] - pz[a];
    let nx = uy * wz - uz * wy, ny = uz * wx - ux * wz, nz = ux * wy - uy * wx;
    const l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
    const d = -(nx * px[a] + ny * py[a] + nz * pz[a]);
    addQ(a, nx, ny, nz, d); addQ(b, nx, ny, nz, d); addQ(c, nx, ny, nz, d);
  }
  let liveF = nf0;

  // optimal collapse position + cost for edge (a,b), from the summed quadric.
  const evalEdge = (a, b) => {
    const o1 = a * 10, o2 = b * 10;
    const q0 = Q[o1] + Q[o2], q1 = Q[o1 + 1] + Q[o2 + 1], q2 = Q[o1 + 2] + Q[o2 + 2], q3 = Q[o1 + 3] + Q[o2 + 3],
      q4 = Q[o1 + 4] + Q[o2 + 4], q5 = Q[o1 + 5] + Q[o2 + 5], q6 = Q[o1 + 6] + Q[o2 + 6],
      q7 = Q[o1 + 7] + Q[o2 + 7], q8 = Q[o1 + 8] + Q[o2 + 8], q9 = Q[o1 + 9] + Q[o2 + 9];
    const det = q0 * (q4 * q7 - q5 * q5) - q1 * (q1 * q7 - q5 * q2) + q2 * (q1 * q5 - q4 * q2);
    let vx, vy, vz;
    if (Math.abs(det) > 1e-12) {
      const idet = 1 / det, bx = -q3, by = -q6, bz = -q8;
      vx = (bx * (q4 * q7 - q5 * q5) - q1 * (by * q7 - q5 * bz) + q2 * (by * q5 - q4 * bz)) * idet;
      vy = (q0 * (by * q7 - bz * q5) - bx * (q1 * q7 - q5 * q2) + q2 * (q1 * bz - by * q2)) * idet;
      vz = (q0 * (q4 * bz - by * q5) - q1 * (q1 * bz - by * q2) + bx * (q1 * q5 - q4 * q2)) * idet;
    } else { vx = (px[a] + px[b]) / 2; vy = (py[a] + py[b]) / 2; vz = (pz[a] + pz[b]) / 2; }
    let cost = q0 * vx * vx + 2 * q1 * vx * vy + 2 * q2 * vx * vz + 2 * q3 * vx
      + q4 * vy * vy + 2 * q5 * vy * vz + 2 * q6 * vy + q7 * vz * vz + 2 * q8 * vz + q9;
    return { cost: cost < 0 ? 0 : cost, vx, vy, vz };
  };

  // binary min-heap of collapse candidates
  const heap = [];
  const hpush = (x) => { heap.push(x); let i = heap.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (heap[p].cost <= heap[i].cost) break; const t = heap[p]; heap[p] = heap[i]; heap[i] = t; i = p; } };
  const hpop = () => { const top = heap[0], last = heap.pop(); if (heap.length) { heap[0] = last; let i = 0; for (;;) { let l = 2 * i + 1, r = 2 * i + 2, s = i; if (l < heap.length && heap[l].cost < heap[s].cost) s = l; if (r < heap.length && heap[r].cost < heap[s].cost) s = r; if (s === i) break; const t = heap[s]; heap[s] = heap[i]; heap[i] = t; i = s; } } return top; };
  const pushEdge = (a, b) => { if (a === b) return; const e = evalEdge(a, b); hpush({ cost: e.cost, a, b, va: ver[a], vb: ver[b], vx: e.vx, vy: e.vy, vz: e.vz }); };

  const seen = new Set();
  for (let i = 0; i < nf0; i++) {
    const a = fa[i], b = fb[i], c = fc[i];
    const pairs = [[a, b], [b, c], [a, c]];
    for (const [x, y] of pairs) { const k = x < y ? x * nv + y : y * nv + x; if (!seen.has(k)) { seen.add(k); pushEdge(x, y); } }
  }

  while (liveF > target && heap.length) {
    const e = hpop();
    const a = e.a, b = e.b;
    if (!alive[a] || !alive[b] || e.va !== ver[a] || e.vb !== ver[b]) continue; // stale
    px[a] = e.vx; py[a] = e.vy; pz[a] = e.vz;
    const o1 = a * 10, o2 = b * 10; for (let t = 0; t < 10; t++) Q[o1 + t] += Q[o2 + t];
    for (const fi of vf[b]) {
      if (!fv[fi]) continue;
      let A = fa[fi], B = fb[fi], C = fc[fi];
      if (A === b) A = a; if (B === b) B = a; if (C === b) C = a;
      if (A === B || B === C || A === C) { // collapsed to a sliver → drop
        fv[fi] = 0; liveF--;
        vf[fa[fi]].delete(fi); vf[fb[fi]].delete(fi); vf[fc[fi]].delete(fi);
      } else { fa[fi] = A; fb[fi] = B; fc[fi] = C; vf[a].add(fi); }
    }
    alive[b] = 0; ver[a]++; ver[b]++; vf[b].clear();
    const nbrs = new Set();
    for (const fi of vf[a]) { if (!fv[fi]) continue; if (fa[fi] !== a && alive[fa[fi]]) nbrs.add(fa[fi]); if (fb[fi] !== a && alive[fb[fi]]) nbrs.add(fb[fi]); if (fc[fi] !== a && alive[fc[fi]]) nbrs.add(fc[fi]); }
    for (const w of nbrs) pushEdge(a, w);
  }

  const remap = new Int32Array(nv).fill(-1);
  const outV = []; let cnt = 0;
  for (let i = 0; i < nv; i++) if (alive[i]) { remap[i] = cnt++; outV.push(px[i], py[i], pz[i]); }
  const outT = [];
  for (let i = 0; i < nf0; i++) if (fv[i]) outT.push(remap[fa[i]], remap[fb[i]], remap[fc[i]]);
  return { verts: outV, tris: outT };
}

// ── Taubin smoothing (λ|μ) ──────────────────────────────────────────────────────
// Removes the high-frequency voxel/aliasing crust WITHOUT the volume shrink plain
// Laplacian causes (the μ pass pushes back out), so the big features — fingers, face
// — survive while the bumps melt off. In place on the indexed surface-nets mesh.
function smoothTaubin(verts, tris, iters, lambda, mu) {
  const nv = verts.length / 3;
  const nbr = Array.from({ length: nv }, () => []);
  const seen = Array.from({ length: nv }, () => new Set());
  const link = (a, b) => { if (a !== b && !seen[a].has(b)) { seen[a].add(b); nbr[a].push(b); } };
  for (let i = 0; i < tris.length; i += 3) {
    const a = tris[i], b = tris[i + 1], c = tris[i + 2];
    link(a, b); link(a, c); link(b, a); link(b, c); link(c, a); link(c, b);
  }
  const tmp = new Float64Array(verts.length);
  const pass = (f) => {
    for (let v = 0; v < nv; v++) {
      const ns = nbr[v], n = ns.length;
      if (n === 0) { tmp[v * 3] = verts[v * 3]; tmp[v * 3 + 1] = verts[v * 3 + 1]; tmp[v * 3 + 2] = verts[v * 3 + 2]; continue; }
      let cx = 0, cy = 0, cz = 0;
      for (let q = 0; q < n; q++) { const m = ns[q] * 3; cx += verts[m]; cy += verts[m + 1]; cz += verts[m + 2]; }
      cx /= n; cy /= n; cz /= n;
      tmp[v * 3] = verts[v * 3] + f * (cx - verts[v * 3]);
      tmp[v * 3 + 1] = verts[v * 3 + 1] + f * (cy - verts[v * 3 + 1]);
      tmp[v * 3 + 2] = verts[v * 3 + 2] + f * (cz - verts[v * 3 + 2]);
    }
    for (let i = 0; i < verts.length; i++) verts[i] = tmp[i];
  };
  for (let it = 0; it < iters; it++) { pass(lambda); pass(mu); }
}

// per-vertex normals from the (smoothed) triangle mesh — area-weighted face normals.
// Used after smoothing, since the field gradient no longer matches the moved verts.
function meshNormals(verts, tris) {
  const normals = new Float32Array(verts.length);
  for (let i = 0; i < tris.length; i += 3) {
    const a = tris[i] * 3, b = tris[i + 1] * 3, c = tris[i + 2] * 3;
    const ux = verts[b] - verts[a], uy = verts[b + 1] - verts[a + 1], uz = verts[b + 2] - verts[a + 2];
    const wx = verts[c] - verts[a], wy = verts[c + 1] - verts[a + 1], wz = verts[c + 2] - verts[a + 2];
    const nx = uy * wz - uz * wy, ny = uz * wx - ux * wz, nz = ux * wy - uy * wx; // area-weighted
    normals[a] += nx; normals[a + 1] += ny; normals[a + 2] += nz;
    normals[b] += nx; normals[b + 1] += ny; normals[b + 2] += nz;
    normals[c] += nx; normals[c + 1] += ny; normals[c + 2] += nz;
  }
  for (let i = 0; i < normals.length; i += 3) {
    const l = Math.hypot(normals[i], normals[i + 1], normals[i + 2]) || 1;
    normals[i] /= l; normals[i + 1] /= l; normals[i + 2] /= l;
  }
  return normals;
}

let rawArgv = typeof __argv === 'function' ? __argv() : (typeof __argv !== 'undefined' ? __argv : []);
if (typeof rawArgv === 'string') { try { rawArgv = JSON.parse(rawArgv); } catch (e) { rawArgv = []; } }
const args = (Array.isArray(rawArgv) ? rawArgv : []).filter(
  (a) => typeof a === 'string' && !a.endsWith('.js') && !a.endsWith('v8cli'),
);

let modelPath = null, grids = [64, 128], name = null, smooth = 12, up = 'z', decimateTo = 0;
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--grid') { grids = args[++i].split(',').map((s) => clamp(parseInt(s, 10) || 64, 16, 320)); continue; }
  if (args[i] === '--name') { name = args[++i]; continue; }
  if (args[i] === '--smooth') { smooth = clamp(parseInt(args[++i], 10) || 0, 0, 200); continue; }
  if (args[i] === '--up') { up = (args[++i] || 'y').toLowerCase(); continue; }
  if (args[i] === '--decimate') { decimateTo = Math.max(0, parseInt(args[++i], 10) || 0); continue; }
  modelPath = args[i];
}
if (!modelPath) { err('usage: sdf-roundtrip.js <model.glb|.obj> [--grid 64,128,256] [--name NAME] [--smooth ITERS]'); throw new Error('no model path'); }
if (!name) { const base = modelPath.split('/').pop(); name = base.replace(/\.(glb|obj)$/i, ''); }

out('sdf-roundtrip: ' + modelPath + '  grids=[' + grids.join(',') + ']  name=' + name);

// load
let mesh;
if (/\.obj$/i.test(modelPath)) {
  const txt = __fs_read(modelPath);
  if (txt == null) throw new Error('cannot read ' + modelPath);
  mesh = loadObj(txt);
} else {
  const bytes = readBytes(modelPath);
  if (!bytes) throw new Error('cannot read ' + modelPath);
  mesh = loadGlb(bytes);
}
out('  loaded ' + mesh.triCount + ' triangles');

// Orient upright: rotate the chosen up-axis to +Y so the OBJ stands in any viewer
// (this model exports Z-up). --up y leaves it as-is. Rotates the triangle soup + its
// bounds in place.
if (up === 'z' || up === 'x') {
  const tv = mesh.tris;
  for (let q = 0; q < tv.length; q += 3) {
    const x = tv[q], y = tv[q + 1], z = tv[q + 2];
    if (up === 'z') { tv[q] = x; tv[q + 1] = z; tv[q + 2] = -y; }   // Z→Y
    else { tv[q] = y; tv[q + 1] = x; tv[q + 2] = z; }               // X→Y
  }
  let m0 = Infinity, m1 = Infinity, m2 = Infinity, m3 = -Infinity, m4 = -Infinity, m5 = -Infinity;
  for (let q = 0; q < tv.length; q += 3) {
    if (tv[q] < m0) m0 = tv[q]; if (tv[q + 1] < m1) m1 = tv[q + 1]; if (tv[q + 2] < m2) m2 = tv[q + 2];
    if (tv[q] > m3) m3 = tv[q]; if (tv[q + 1] > m4) m4 = tv[q + 1]; if (tv[q + 2] > m5) m5 = tv[q + 2];
  }
  mesh.bounds = [m0, m1, m2, m3, m4, m5];
  out('  reoriented ' + up + '-up → Y-up');
}

// center at origin, compute framing radius
const bnd = mesh.bounds;
const cx = (bnd[0] + bnd[3]) / 2, cy = (bnd[1] + bnd[4]) / 2, cz = (bnd[2] + bnd[5]) / 2;
let R0 = 0;
for (let t = 0; t < mesh.triCount; t++) {
  for (let c = 0; c < 3; c++) {
    const o = t * 9 + c * 3;
    mesh.tris[o] -= cx; mesh.tris[o + 1] -= cy; mesh.tris[o + 2] -= cz;
    const r = Math.hypot(mesh.tris[o], mesh.tris[o + 1], mesh.tris[o + 2]);
    if (r > R0) R0 = r;
  }
}
const R = R0 * 1.06;

const dir = 'cart/editor/data/models/roundtrip/' + name;

// Emit the CENTERED source as an OBJ too, so the lab shows original and every bake
// in one shared frame (same origin, same scale) — the A/B flip is only honest at
// one camera. Triangle soup with face normals; no vertex welding needed for a viewer.
{
  const tv = mesh.tris, T = mesh.triCount;
  const sv = new Float32Array(T * 9), sn = new Float32Array(T * 9), st = new Uint32Array(T * 3);
  for (let t = 0; t < T; t++) {
    const o = t * 9;
    const ux = tv[o + 3] - tv[o], uy = tv[o + 4] - tv[o + 1], uz = tv[o + 5] - tv[o + 2];
    const wx = tv[o + 6] - tv[o], wy = tv[o + 7] - tv[o + 1], wz = tv[o + 8] - tv[o + 2];
    let nx = uy * wz - uz * wy, ny = uz * wx - ux * wz, nz = ux * wy - uy * wx;
    const l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
    for (let c = 0; c < 3; c++) {
      sv[o + c * 3] = tv[o + c * 3]; sv[o + c * 3 + 1] = tv[o + c * 3 + 1]; sv[o + c * 3 + 2] = tv[o + c * 3 + 2];
      sn[o + c * 3] = nx; sn[o + c * 3 + 1] = ny; sn[o + c * 3 + 2] = nz;
      st[t * 3 + c] = t * 3 + c;
    }
  }
  writeObj(dir + '/' + name + '_original.obj', sv, st, sn,
    '# ' + name + ' — centered source (scripts/sdf-roundtrip.js, req_2604)\n# source ' + modelPath);
}

const bakes = [];
for (const N of grids) {
  const t0 = Date.now();
  const G = meshToGrid(mesh, R, N);
  const field = makeSampler(G);
  const rm = surfaceNets(field, R, N);
  const nVerts = rm.verts.length / 3;
  if (nVerts === 0) { err('  grid ' + N + ': empty mesh (field never crossed zero) — skipping'); continue; }
  // Winding audit (nug-gen.js pattern): a CCW-from-outside triangle's geometric
  // normal must align with the field gradient (which points outward). Below ~99%
  // means the mesher wound inward and the engine will backface-cull the surface.
  {
    let ok = 0, total = 0;
    const v = rm.verts, t = rm.tris, ge = G.cell * 0.5;
    for (let i = 0; i < t.length; i += 3) {
      const a = t[i] * 3, b = t[i + 1] * 3, c = t[i + 2] * 3;
      const ux = v[b] - v[a], uy = v[b + 1] - v[a + 1], uz = v[b + 2] - v[a + 2];
      const wx = v[c] - v[a], wy = v[c + 1] - v[a + 1], wz = v[c + 2] - v[a + 2];
      const gx = uy * wz - uz * wy, gy = uz * wx - ux * wz, gz = ux * wy - uy * wx;
      const cx2 = (v[a] + v[b] + v[c]) / 3, cy2 = (v[a + 1] + v[b + 1] + v[c + 1]) / 3, cz2 = (v[a + 2] + v[b + 2] + v[c + 2]) / 3;
      const dx = field(cx2 + ge, cy2, cz2) - field(cx2 - ge, cy2, cz2);
      const dy = field(cx2, cy2 + ge, cz2) - field(cx2, cy2 - ge, cz2);
      const dz = field(cx2, cy2, cz2 + ge) - field(cx2, cy2, cz2 - ge);
      total++;
      if (gx * dx + gy * dy + gz * dz > 0) ok++;
    }
    out('  grid ' + N + ': winding ' + (100 * ok / total).toFixed(1) + '% outward');
  }
  // Decimate FIRST (bake-high-then-decimate: quadric collapse keeps fingers/face, drops
  // flat triangles) so the low-poly result carries detail a raw low grid never sampled.
  if (decimateTo > 0 && rm.tris.length / 3 > decimateTo) {
    const before = rm.tris.length / 3;
    const d = decimate(rm.verts, rm.tris, decimateTo);
    rm.verts = d.verts; rm.tris = d.tris;
    out('  grid ' + N + ': decimated ' + before + ' → ' + (rm.tris.length / 3) + ' tris');
  }
  // Smooth off the voxel crust (Taubin, feature-preserving), then take normals from
  // the smoothed geometry. --smooth 0 leaves the raw surface-nets output for A/B.
  if (smooth > 0) smoothTaubin(rm.verts, rm.tris, smooth, 0.5, -0.53);
  const normals = meshNormals(rm.verts, rm.tris);
  const objPath = dir + '/' + name + '_' + N + '.obj';
  const header = '# ' + name + ' — SDF round-trip @ ' + N + '^3, smooth=' + smooth + ', decimate=' + decimateTo + ' (scripts/sdf-roundtrip.js, req_2604)\n'
    + '# source ' + modelPath + '  src_tris ' + mesh.triCount;
  if (!writeObj(objPath, rm.verts, rm.tris, normals, header)) { err('  grid ' + N + ': write failed'); continue; }
  const tris = rm.tris.length / 3;
  bakes.push({ grid: N, path: objPath, tris });
  out('  grid ' + N + '^3: ' + tris + ' tris  (' + ((Date.now() - t0) / 1000).toFixed(1) + 's)');
}

// manifest for the lab
const manifest = {
  version: 1,
  name,
  source: modelPath,
  sourceTris: mesh.triCount,
  radius: R,
  original: dir + '/' + name + '_original.obj',
  bakes,
  generator: 'scripts/sdf-roundtrip.js',
};
__fs_write(dir + '/manifest.json', JSON.stringify(manifest, null, 2) + '\n');
out('done → ' + dir);
