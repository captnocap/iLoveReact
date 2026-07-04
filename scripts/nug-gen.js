// nug-gen.js — seeded procedural nug meshes (USER ASK req_2571).
//
// Port of noahsprerogative.com/trichome's generator (deobfuscated reference in
// session scratchpad: trichome-{params,view,sdf}.pretty.js). The site raymarches
// a signed-distance field per pixel; we evaluate the SAME field on a voxel grid
// and extract a mesh with surface nets, so each seed becomes a real prop model.
//
//   seed string ─→ DNA (13 params) ─→ placement (calyx bulges / leaves / pistils)
//        ─→ SDF (body + leaves) ─→ surface nets ─→ OBJ + baked vertex albedo
//        ─→ model package (manifest.json + mesh/) + preview PNG (base64 sidecar)
//
// Pistils are NOT meshed (400 hair-capsules would dominate the triangle budget
// and vanish sub-pixel at prop scale) — they bake in as amber/rust albedo flecks
// at their anchor points, matching the plan reviewed in-session.
//
// Run:  tools/v8cli scripts/nug-gen.js <seed> [<seed> ...]
//   or: tools/v8cli scripts/nug-gen.js            (default demo seeds)
// Output: cart/editor/data/models/props/nug_<seed>/{manifest.json,mesh/nug_<seed>.obj,preview.png.b64}
// Decode previews after: base64 -d preview.png.b64 > preview.png
//
// OBJ note: `v x y z r g b` — mesh_import.zig's pushFloats reads exactly 3
// floats and ignores the trailing color triple, so the same file carries the
// baked albedo for a future COLOR-aware loader without breaking today's viewer.

'use strict';

const out = (s) => __writeStdout(s + '\n');
const err = (s) => __writeStderr(s + '\n');

// ── seed & noise (byte-faithful ports of the site's core) ─────────────────────

function hashToSeed(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (Math.imul(31, h) + str.charCodeAt(i)) | 0;
  return h;
}
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const fract = (x) => x - Math.floor(x);
const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
const lerp = (a, b, t) => a + (b - a) * t;

// GLSL-matching 3D value noise (hash13/vnoise from the shader's COMMON block).
function hash13(px, py, pz) {
  let x = fract(px * 0.1031), y = fract(py * 0.1031), z = fract(pz * 0.1031);
  const d = x * (y + 33.33) + y * (z + 33.33) + z * (x + 33.33);
  x += d; y += d; z += d;
  return fract((x + y) * z);
}
function vnoise(x, y, z) {
  const px = Math.floor(x), py = Math.floor(y), pz = Math.floor(z);
  let fx = x - px, fy = y - py, fz = z - pz;
  fx = fx * fx * (3 - 2 * fx); fy = fy * fy * (3 - 2 * fy); fz = fz * fz * (3 - 2 * fz);
  const c = (i, j, k) => hash13(px + i, py + j, pz + k);
  return lerp(
    lerp(lerp(c(0, 0, 0), c(1, 0, 0), fx), lerp(c(0, 1, 0), c(1, 1, 0), fx), fy),
    lerp(lerp(c(0, 0, 1), c(1, 0, 1), fx), lerp(c(0, 1, 1), c(1, 1, 1), fx), fy),
    fz);
}

// ── DNA roll (trichome-params.js) ──────────────────────────────────────────────

const DNA = [
  { key: 'length',      int: false, rand: [1.5, 2.6],  dec: 2 },
  { key: 'girth',       int: false, rand: [0.5, 0.85], dec: 2 },
  { key: 'taper',       int: false, rand: [0.2, 0.9],  dec: 2 },
  { key: 'calyxCount',  int: true,  rand: [80, 124] },
  { key: 'calyxSize',   int: false, rand: [0.85, 1.2], dec: 2 },
  { key: 'jitter',      int: false, rand: [0.4, 1.1],  dec: 2 },
  { key: 'leafCount',   int: true,  rand: [90, 190] },
  { key: 'leafSize',    int: false, rand: [0.32, 0.7], dec: 2 },
  { key: 'pistilCount', int: true,  rand: [240, 390] },
  { key: 'frost',       int: false, rand: [0.55, 1],   dec: 2 },
  { key: 'hue',         int: false, rand: [92, 128],   dec: 0 },
  { key: 'sat',         int: false, rand: [34, 68],    dec: 0 },
  { key: 'purple',      int: false, rand: [0, 0.85],   dec: 2 },
];

function rollDna(seed) {
  const rng = mulberry32(hashToSeed(seed + '|dna'));
  const p = { seed };
  for (const spec of DNA) {
    let v = spec.rand[0] + rng() * (spec.rand[1] - spec.rand[0]);
    p[spec.key] = spec.int ? Math.round(v) : +v.toFixed(spec.dec);
  }
  return p;
}

// ── placement (trichome-view.js buildPlacement) ────────────────────────────────

function seedNum(p) { return (hashToSeed(p.seed) >>> 0) % 100000; }

function buildPlacement(p) {
  const sn = seedNum(p);
  const TAU = 6.2831853, PI = 3.14159265;
  const envT = (t) => Math.pow(Math.sin(PI * (0.10 + 0.80 * t)), lerp(0.45, 0.9, clamp(p.taper, 0, 1)));
  const rj = (i, kind) => fract(Math.sin(i * 12.9898 + kind * 4.1414 + sn * 0.137) * 43758.5453);
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const norm = (v) => { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };

  const bulge = (bi) => {
    const t = (bi + rj(bi, 1)) / p.calyxCount;
    const coreR = p.girth * envT(t);
    const y = (t - 0.55) * p.length;
    const ang = rj(bi, 2) * TAU;
    const rho = coreR * (0.5 + 0.35 * rj(bi, 3));
    const r = coreR * (0.24 + 0.22 * rj(bi, 4)) * p.calyxSize;
    const jj = coreR * p.jitter * 0.3;
    const c = [Math.cos(ang) * rho + (rj(bi, 5) - 0.5) * jj,
               y + (rj(bi, 6) - 0.5) * jj,
               Math.sin(ang) * rho + (rj(bi, 7) - 0.5) * jj];
    const rl = Math.hypot(c[0], 0, c[2]);
    return { c, r, outDir: rl > 1e-4 ? [c[0] / rl, 0, c[2] / rl] : [1, 0, 0] };
  };

  let geoR = 0.55 * p.length + 0.5 * p.girth;
  const bracts = [];
  for (let i = 0; i < p.calyxCount; i++) {
    const b = bulge(i);
    bracts.push(b);
    geoR = Math.max(geoR, Math.hypot(b.c[0], b.c[1], b.c[2]) + b.r);
  }

  const leaves = [];
  for (let i = 0; i < p.leafCount; i++) {
    const b = bulge(Math.floor(rj(i, 8) * p.calyxCount));
    const anchor = [b.c[0] + b.outDir[0] * b.r * 0.55,
                    b.c[1] + b.outDir[1] * b.r * 0.55,
                    b.c[2] + b.outDir[2] * b.r * 0.55];
    const size = p.girth * envT((Math.floor(rj(i, 8) * p.calyxCount) + 0.5) / p.calyxCount)
               * p.leafSize * (0.55 + 0.45 * rj(i, 5));
    const upRef = Math.abs(b.outDir[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
    const side = norm(cross(upRef, b.outDir));
    const wob = (rj(i, 3) - 0.5) * 1.3;
    const dir = norm([b.outDir[0] * 0.8 + side[0] * wob,
                      b.outDir[1] * 0.8 + side[1] * wob + 0.5 * (rj(i, 4) - 0.25),
                      b.outDir[2] * 0.8 + side[2] * wob]);
    const upRef2 = Math.abs(dir[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
    const xax = norm(cross(upRef2, dir));
    leaves.push({ anchor, dir, xax, zax: cross(dir, xax), size });
    const tip = [anchor[0] + dir[0] * size, anchor[1] + dir[1] * size, anchor[2] + dir[2] * size];
    geoR = Math.max(geoR, Math.hypot(tip[0], tip[1], tip[2]));
  }

  // Pistils: anchors only (albedo flecks, not geometry).
  const pistils = [];
  for (let i = 0; i < p.pistilCount; i++) {
    const b = bulge(Math.floor(rj(i, 8) * p.calyxCount));
    let n = [2 * rj(i, 20) - 1, 2 * rj(i, 21) - 1, 2 * rj(i, 22) - 1];
    if (n[0] * b.outDir[0] + n[1] * b.outDir[1] + n[2] * b.outDir[2] < 0) n = [-n[0], -n[1], -n[2]];
    const nrm = norm([n[0] + b.outDir[0] * 0.7, n[1] + b.outDir[1] * 0.7, n[2] + b.outDir[2] * 0.7]);
    pistils.push({
      anchor: [b.c[0] + nrm[0] * b.r * 0.9, b.c[1] + nrm[1] * b.r * 0.9, b.c[2] + nrm[2] * b.r * 0.9],
      var01: fract(i * 0.618034),
    });
  }

  return { bracts, leaves, pistils, geoR: geoR + 0.12, envT };
}

// ── SDF (trichome-sdf.js, body + leaves; leaf sheet inflated to grid scale) ────

function smin(a, b, k) {
  if (k <= 0) return Math.min(a, b);
  const h = clamp(0.5 + 0.5 * (b - a) / k, 0, 1);
  return lerp(b, a, h) - k * h * (1 - h);
}

function makeField(p, pl, cellSize) {
  const PI = 3.14159265;
  // Fatten the paper-thin leaf sheet (~0.008 world) to be resolvable by the
  // voxel grid — chunky pixel-art foliage, deliberate at prop scale.
  const leafInflate = Math.max(0, cellSize * 0.75 - 0.009);

  const sdCore = (x, y, z) => {
    let d = 1e9;
    for (let i = 0; i < 14; i++) {
      const t = i / 13;
      const cy = (t - 0.55) * p.length;
      d = smin(d, Math.hypot(x, y - cy, z) - p.girth * pl.envT(t) * 0.5, 0.12);
    }
    return d;
  };

  const sdBody = (x, y, z) => {
    let d = sdCore(x, y, z);
    for (const b of pl.bracts) {
      const bd = Math.hypot(x - b.c[0], y - b.c[1], z - b.c[2]) - b.r;
      if (bd - d < 0.05) d = smin(d, bd, 0.05);
    }
    return d;
  };

  const sdLeafLocal = (x, y, z) => {
    const L = 1.0, W = 0.19, Tz = 0.034, curve = 0.18, teeth = 6.0, toothDepth = 0.30;
    const yc = clamp(y, 0, L), t = yc / L;
    let w = W * Math.pow(Math.sin(PI * (0.10 + 0.86 * t)), 0.75);
    w *= 1 - toothDepth * Math.max(0, Math.sin(t * PI * teeth));
    const zc = z - curve * t * t;
    const ax = Math.max(Math.abs(x) - w, 0);
    const az = Math.max(Math.abs(zc) - Tz, 0);
    const ay = Math.max(Math.max(-y, y - L), 0);
    return Math.hypot(ax, ay, az) - 0.018;
  };

  const sdLeaves = (x, y, z) => {
    let d = 1e9;
    for (const lf of pl.leaves) {
      const px = x - lf.anchor[0], py = y - lf.anchor[1], pz = z - lf.anchor[2];
      const s = lf.size;
      if (px * px + py * py + pz * pz > (s * 2) * (s * 2)) continue;
      const lx = px * lf.xax[0] + py * lf.xax[1] + pz * lf.xax[2];
      const ly = px * lf.dir[0] + py * lf.dir[1] + pz * lf.dir[2];
      const lz = px * lf.zax[0] + py * lf.zax[1] + pz * lf.zax[2];
      d = Math.min(d, sdLeafLocal(lx / s, ly / s, lz / s) * s - leafInflate);
    }
    return d;
  };

  return {
    field: (x, y, z) => Math.min(sdBody(x, y, z), sdLeaves(x, y, z)),
    sdBody,
    sdLeaves,
  };
}

// ── surface nets mesher ────────────────────────────────────────────────────────

function surfaceNets(field, R, N) {
  const M = N + 1;
  const cell = (2 * R) / N;
  const at = (i) => -R + i * cell;

  const grid = new Float32Array(M * M * M);
  for (let k = 0; k < M; k++)
    for (let j = 0; j < M; j++)
      for (let i = 0; i < M; i++)
        grid[(k * M + j) * M + i] = field(at(i), at(j), at(k));

  // One vertex per sign-crossing cell: mean of its edge crossings.
  const cellVert = new Int32Array(N * N * N).fill(-1);
  const verts = [];
  const EDGES = [];
  for (let a = 0; a < 8; a++)
    for (let b = a + 1; b < 8; b++)
      if (((a ^ b) & ((a ^ b) - 1)) === 0) EDGES.push([a, b]); // corners differing in one bit
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

  // Quads: for each lattice edge with a sign change, join the 4 cells around it.
  const tris = [];
  const gv = (i, j, k) => grid[(k * M + j) * M + i];
  const cv = (i, j, k) => cellVert[(k * N + j) * N + i];
  // Winding: the engine draws with cull_mode=.back, front_face=.ccw
  // (framework/gpu/3d.zig), so triangles must be CCW seen from OUTSIDE the
  // surface. Verified post-build against the SDF gradient (see main()).
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
        if ((s0 < 0) !== (ex < 0))
          quad(cv(i, j - 1, k - 1), cv(i, j, k - 1), cv(i, j, k), cv(i, j - 1, k), s0 < 0);
        if ((s0 < 0) !== (ey < 0))
          quad(cv(i - 1, j, k - 1), cv(i - 1, j, k), cv(i, j, k), cv(i, j, k - 1), s0 < 0);
        if ((s0 < 0) !== (ez < 0))
          quad(cv(i - 1, j - 1, k), cv(i, j - 1, k), cv(i, j, k), cv(i - 1, j, k), s0 < 0);
      }

  return { verts, tris };
}

// ── albedo bake (frostShade minus view/light terms) ────────────────────────────

function hsl2rgb01(h, s, l) {
  h = ((h % 360) + 360) % 360 / 360;
  const r = (n) => clamp(Math.abs(((h * 6 + n) % 6) - 3) - 1, 0, 1);
  const c = (1 - Math.abs(2 * l - 1)) * s;
  return [l + c * (r(0) - 0.5), l + c * (r(4) - 0.5), l + c * (r(2) - 0.5)];
}

function bakeAlbedo(p, pl, F, verts, normals) {
  const field = F.field;
  const n = verts.length / 3;
  const colors = new Float32Array(n * 3);

  // Pistil flecks: nearest-anchor lookup, brute force (anchors ≤ ~400).
  const fleckR2 = 0.05 * 0.05;

  for (let vi = 0; vi < n; vi++) {
    const x = verts[vi * 3], y = verts[vi * 3 + 1], z = verts[vi * 3 + 2];
    const nx = normals[vi * 3], ny = normals[vi * 3 + 1], nz = normals[vi * 3 + 2];

    // Material split, mirroring the shader's hid classification: leaves get the
    // fixed leaf look (hue 100, sat .40, frost .80, no purple), body gets DNA.
    const isLeaf = F.sdLeaves(x, y, z) < F.sdBody(x, y, z);
    const hue = isLeaf ? 100 : p.hue;
    const satBase = isLeaf ? 0.40 : p.sat / 100;
    const frost = isLeaf ? 0.80 : p.frost;
    const purpleAmt = isLeaf ? 0 : p.purple;

    // AO — 5 taps along the normal, same constants as the shader.
    let occ = 0, sca = 1;
    for (let s = 1; s <= 5; s++) {
      const h = 0.05 * s * pl.geoR;
      occ += (h - field(x + nx * h, y + ny * h, z + nz * h)) * sca;
      sca *= 0.8;
    }
    occ = clamp(1 - 1.5 * occ, 0, 1);

    // Brightness stand-in: AO only (light is the renderer's job). Steep ramp so
    // crevices go properly dark green like the site's deep-shadow look.
    const Bq = clamp(0.12 + 0.88 * occ * occ, 0, 1);
    const l = clamp(lerp(0.26, 0.58, Bq), 0, 1);
    const satv = lerp(satBase, satBase * 0.5, Bq);
    let [r, g, b] = hsl2rgb01(hue, satv, l);

    // Purple anthocyanin — RGB mix, intensity varied by 2-octave noise.
    if (purpleAmt > 0) {
      const pn = vnoise(x * 2.2 + 5, y * 2.2, z * 2.2) * 0.6 + vnoise(x * 4.8, y * 4.8, z * 4.8) * 0.4;
      const mask = purpleAmt * clamp(0.42 + 0.85 * (pn - 0.45), 0, 1);
      const [pr, pg, pb] = hsl2rgb01(291, 0.56, clamp(l * 0.9 + 0.07, 0.10, 0.44));
      r = lerp(r, pr, mask); g = lerp(g, pg, mask); b = lerp(b, pb, mask);

      // frost recedes over purple
      var milky = frost * lerp(0.36, 0.80, Bq) * lerp(0.26, 1, occ) * (1 - mask * 0.72);
    } else {
      milky = frost * lerp(0.36, 0.80, Bq) * lerp(0.26, 1, occ);
    }
    r = lerp(r, 0.839, milky); g = lerp(g, 0.875, milky); b = lerp(b, 0.784, milky);

    // trichome grain + mild baked sparkle (amplified ~1.5x vs the shader — per-
    // vertex interpolation smooths it back down)
    const grain = ((vnoise(x * 18 + 9, y * 18 + 9, z * 18 + 9) - 0.5) * 0.36
                 + (vnoise(x * 38 + 3, y * 38 + 3, z * 38 + 3) - 0.5) * 0.26) * frost;
    r = clamp(r + grain, 0, 1); g = clamp(g + grain, 0, 1); b = clamp(b + grain, 0, 1);
    const g2 = vnoise(x * 70 + 11, y * 70, z * 70);
    const sparkle = clamp(Math.pow(clamp((g2 - 0.5) / 0.5, 0, 1), 1.8) * 0.85 * frost, 0, 1);
    r = lerp(r, 1, sparkle); g = lerp(g, 1, sparkle); b = lerp(b, 1, sparkle);

    colors[vi * 3] = r; colors[vi * 3 + 1] = g; colors[vi * 3 + 2] = b;
  }

  // Amber/rust pistil flecks over the frost.
  for (const pt of pl.pistils) {
    const age = clamp(0.18 + pt.var01 * 0.80, 0, 1);
    const [fr, fg, fb] = hsl2rgb01(lerp(38, 13, age), lerp(0.30, 0.52, age), lerp(0.63, 0.34, age));
    for (let vi = 0; vi < n; vi++) {
      const dx = verts[vi * 3] - pt.anchor[0], dy = verts[vi * 3 + 1] - pt.anchor[1], dz = verts[vi * 3 + 2] - pt.anchor[2];
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 > fleckR2) continue;
      const w = 1 - d2 / fleckR2;
      colors[vi * 3] = lerp(colors[vi * 3], fr, w);
      colors[vi * 3 + 1] = lerp(colors[vi * 3 + 1], fg, w);
      colors[vi * 3 + 2] = lerp(colors[vi * 3 + 2], fb, w);
    }
  }

  return colors;
}

// ── PNG encoder (stored-deflate; no compression dependency) ────────────────────

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function adler32(bytes) {
  let a = 1, b = 0;
  for (let i = 0; i < bytes.length; i++) { a = (a + bytes[i]) % 65521; b = (b + a) % 65521; }
  return ((b << 16) | a) >>> 0;
}
function pngEncode(w, h, rgba) {
  const raw = new Uint8Array(h * (w * 4 + 1)); // filter byte 0 per row
  for (let y = 0; y < h; y++) raw.set(rgba.subarray(y * w * 4, (y + 1) * w * 4), y * (w * 4 + 1) + 1);
  // zlib stream: header + stored deflate blocks (max 65535 each) + adler
  const blocks = Math.ceil(raw.length / 65535) || 1;
  const z = new Uint8Array(2 + raw.length + blocks * 5 + 4);
  z[0] = 0x78; z[1] = 0x01;
  let zo = 2;
  for (let off = 0, bi = 0; bi < blocks; bi++) {
    const len = Math.min(65535, raw.length - off);
    z[zo++] = bi === blocks - 1 ? 1 : 0;
    z[zo++] = len & 0xff; z[zo++] = len >>> 8;
    z[zo++] = ~len & 0xff; z[zo++] = (~len >>> 8) & 0xff;
    z.set(raw.subarray(off, off + len), zo); zo += len; off += len;
  }
  const ad = adler32(raw);
  z[zo++] = ad >>> 24; z[zo++] = (ad >>> 16) & 0xff; z[zo++] = (ad >>> 8) & 0xff; z[zo++] = ad & 0xff;

  const chunk = (type, data) => {
    const buf = new Uint8Array(12 + data.length);
    const dv = new DataView(buf.buffer);
    dv.setUint32(0, data.length);
    for (let i = 0; i < 4; i++) buf[4 + i] = type.charCodeAt(i);
    buf.set(data, 8);
    const crcable = buf.subarray(4, 8 + data.length);
    dv.setUint32(8 + data.length, crc32(crcable));
    return buf;
  };
  const ihdr = new Uint8Array(13);
  const dv = new DataView(ihdr.buffer);
  dv.setUint32(0, w); dv.setUint32(4, h);
  ihdr[8] = 8; ihdr[9] = 6; // 8-bit RGBA
  const parts = [
    Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', z), chunk('IEND', new Uint8Array(0)),
  ];
  let total = 0;
  for (const pt of parts) total += pt.length;
  const png = new Uint8Array(total);
  let o = 0;
  for (const pt of parts) { png.set(pt, o); o += pt.length; }
  return png;
}
const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
function base64(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i], b = i + 1 < bytes.length ? bytes[i + 1] : 0, c = i + 2 < bytes.length ? bytes[i + 2] : 0;
    s += B64[a >> 2] + B64[((a & 3) << 4) | (b >> 4)]
       + (i + 1 < bytes.length ? B64[((b & 15) << 2) | (c >> 6)] : '=')
       + (i + 2 < bytes.length ? B64[c & 63] : '=');
  }
  return s;
}

// ── preview raster (orthographic z-buffer, lambert × baked albedo) ─────────────

function renderPreview(verts, tris, normals, colors, geoR, pane, yaws, pitch) {
  const W = pane * yaws.length, H = pane;
  const rgba = new Uint8Array(W * H * 4);
  for (let i = 0; i < W * H; i++) { rgba[i * 4 + 0] = 10; rgba[i * 4 + 1] = 11; rgba[i * 4 + 2] = 14; rgba[i * 4 + 3] = 255; }

  for (let p = 0; p < yaws.length; p++) {
    const yaw = yaws[p];
    const cy = Math.cos(yaw), sy = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch);
    const fwd = [sy * cp, sp, cy * cp];
    let right = [fwd[2], 0, -fwd[0]];
    const rl = Math.hypot(right[0], right[1], right[2]) || 1;
    right = [right[0] / rl, right[1] / rl, right[2] / rl];
    const up = [fwd[1] * right[2] - fwd[2] * right[1], fwd[2] * right[0] - fwd[0] * right[2], fwd[0] * right[1] - fwd[1] * right[0]];
    // light authored in view frame, rotated to world (matches the site's turntable feel)
    const lv = [0.4, 0.65, -0.65];
    const light = [
      lv[0] * right[0] + lv[1] * up[0] + lv[2] * fwd[0],
      lv[0] * right[1] + lv[1] * up[1] + lv[2] * fwd[1],
      lv[0] * right[2] + lv[1] * up[2] + lv[2] * fwd[2],
    ];
    const ll = Math.hypot(light[0], light[1], light[2]);
    light[0] /= ll; light[1] /= ll; light[2] /= ll;

    const scale = (pane * 0.46) / geoR;
    const zbuf = new Float32Array(pane * pane).fill(-1e9);
    const px0 = p * pane;

    const proj = (vi) => {
      const x = verts[vi * 3], y = verts[vi * 3 + 1], z = verts[vi * 3 + 2];
      return [
        pane / 2 + (x * right[0] + y * right[1] + z * right[2]) * scale,
        pane / 2 - (x * up[0] + y * up[1] + z * up[2]) * scale,
        -(x * fwd[0] + y * fwd[1] + z * fwd[2]),
      ];
    };

    for (let t = 0; t < tris.length; t += 3) {
      const A = proj(tris[t]), Bv = proj(tris[t + 1]), C = proj(tris[t + 2]);
      const minX = Math.max(0, Math.floor(Math.min(A[0], Bv[0], C[0])));
      const maxX = Math.min(pane - 1, Math.ceil(Math.max(A[0], Bv[0], C[0])));
      const minY = Math.max(0, Math.floor(Math.min(A[1], Bv[1], C[1])));
      const maxY = Math.min(pane - 1, Math.ceil(Math.max(A[1], Bv[1], C[1])));
      const den = (Bv[1] - C[1]) * (A[0] - C[0]) + (C[0] - Bv[0]) * (A[1] - C[1]);
      if (Math.abs(den) < 1e-9) continue;
      for (let y = minY; y <= maxY; y++)
        for (let x = minX; x <= maxX; x++) {
          const w0 = ((Bv[1] - C[1]) * (x - C[0]) + (C[0] - Bv[0]) * (y - C[1])) / den;
          const w1 = ((C[1] - A[1]) * (x - C[0]) + (A[0] - C[0]) * (y - C[1])) / den;
          const w2 = 1 - w0 - w1;
          if (w0 < 0 || w1 < 0 || w2 < 0) continue;
          const z = w0 * A[2] + w1 * Bv[2] + w2 * C[2];
          const zi = y * pane + x;
          if (z <= zbuf[zi]) continue;
          zbuf[zi] = z;
          const i0 = tris[t], i1 = tris[t + 1], i2 = tris[t + 2];
          let nx = w0 * normals[i0 * 3] + w1 * normals[i1 * 3] + w2 * normals[i2 * 3];
          let ny = w0 * normals[i0 * 3 + 1] + w1 * normals[i1 * 3 + 1] + w2 * normals[i2 * 3 + 1];
          let nz = w0 * normals[i0 * 3 + 2] + w1 * normals[i1 * 3 + 2] + w2 * normals[i2 * 3 + 2];
          const nl = Math.hypot(nx, ny, nz) || 1;
          nx /= nl; ny /= nl; nz /= nl;
          const lam = Math.max(0, nx * light[0] + ny * light[1] + nz * light[2]);
          const lit = 0.30 + 0.70 * lam;
          const o = ((y * W) + px0 + x) * 4;
          rgba[o] = Math.round(clamp((w0 * colors[i0 * 3] + w1 * colors[i1 * 3] + w2 * colors[i2 * 3]) * lit, 0, 1) * 255);
          rgba[o + 1] = Math.round(clamp((w0 * colors[i0 * 3 + 1] + w1 * colors[i1 * 3 + 1] + w2 * colors[i2 * 3 + 1]) * lit, 0, 1) * 255);
          rgba[o + 2] = Math.round(clamp((w0 * colors[i0 * 3 + 2] + w1 * colors[i1 * 3 + 2] + w2 * colors[i2 * 3 + 2]) * lit, 0, 1) * 255);
          rgba[o + 3] = 255;
        }
    }
  }
  return { rgba, W, H };
}

// ── package writer ─────────────────────────────────────────────────────────────

function writePackage(seed, p, mesh, normals, colors, geoR, triCount) {
  const dir = 'cart/editor/data/models/props/nug_' + seed;
  const objName = 'nug_' + seed + '.obj';

  let obj = '# nug ' + seed + ' — generated by scripts/nug-gen.js (seeded SDF -> surface nets)\n';
  obj += '# dna ' + JSON.stringify(p) + '\n';
  const v = mesh.verts;
  for (let i = 0; i < v.length; i += 3) {
    const ci = i;
    obj += 'v ' + v[i].toFixed(4) + ' ' + v[i + 1].toFixed(4) + ' ' + v[i + 2].toFixed(4)
         + ' ' + colors[ci].toFixed(3) + ' ' + colors[ci + 1].toFixed(3) + ' ' + colors[ci + 2].toFixed(3) + '\n';
  }
  for (let i = 0; i < normals.length; i += 3)
    obj += 'vn ' + normals[i].toFixed(3) + ' ' + normals[i + 1].toFixed(3) + ' ' + normals[i + 2].toFixed(3) + '\n';
  const t = mesh.tris;
  for (let i = 0; i < t.length; i += 3) {
    const a = t[i] + 1, b = t[i + 1] + 1, c = t[i + 2] + 1;
    obj += 'f ' + a + '//' + a + ' ' + b + '//' + b + ' ' + c + '//' + c + '\n';
  }

  const manifest = {
    version: 1,
    id: 'nug:' + seed,
    name: 'Nug ' + seed,
    kind: 'prop',
    stage: 'ready',
    folderId: 'props',
    semanticKind: 'prop',
    sourceKind: 'generated',
    color: '#7da878',
    rig: 'seeded SDF bake',
    data: 'file ' + objName,
    triangles: triCount,
    lods: 0,
    mesh: { viewerPath: dir + '/mesh/' + objName },
    decompositions: [
      'semantic:prop',
      'format:obj',
      'generator:scripts/nug-gen.js',
      'seed:' + seed,
    ],
    atlases: [],
    paints: [],
  };

  if (!__fs_write(dir + '/mesh/' + objName, obj)) return null;
  if (!__fs_write(dir + '/manifest.json', JSON.stringify(manifest, null, 2) + '\n')) return null;
  return dir;
}

// ── main ───────────────────────────────────────────────────────────────────────

const argv = typeof __argv !== 'undefined' ? __argv : [];
const seeds = argv.length ? argv : ['63fc8dc5', 'c2554ea5', 'b24275a1', '461f32af'];
const GRID_N = 88;

for (const seed of seeds) {
  const t0 = Date.now();
  const p = rollDna(seed);
  const pl = buildPlacement(p);
  const cellSize = (2 * pl.geoR) / GRID_N;
  const F = makeField(p, pl, cellSize);
  const field = F.field;

  const mesh = surfaceNets(field, pl.geoR, GRID_N);
  const nVerts = mesh.verts.length / 3;
  if (nVerts === 0) { err('seed ' + seed + ': empty mesh, skipping'); continue; }

  // normals from SDF gradient
  const normals = new Float32Array(mesh.verts.length);
  const e = cellSize * 0.5;
  for (let i = 0; i < nVerts; i++) {
    const x = mesh.verts[i * 3], y = mesh.verts[i * 3 + 1], z = mesh.verts[i * 3 + 2];
    let nx = field(x + e, y, z) - field(x - e, y, z);
    let ny = field(x, y + e, z) - field(x, y - e, z);
    let nz = field(x, y, z + e) - field(x, y, z - e);
    const l = Math.hypot(nx, ny, nz) || 1;
    normals[i * 3] = nx / l; normals[i * 3 + 1] = ny / l; normals[i * 3 + 2] = nz / l;
  }

  // Winding audit: a CCW-from-outside triangle's geometric normal
  // (cross(b-a, c-a), right-hand rule) must point OUT of the surface, i.e.
  // along the SDF gradient. Anything under ~99% means the mesher regressed.
  {
    let ok = 0, total = 0;
    const v = mesh.verts, t = mesh.tris;
    for (let i = 0; i < t.length; i += 3) {
      const a = t[i] * 3, b = t[i + 1] * 3, c = t[i + 2] * 3;
      const ux = v[b] - v[a], uy = v[b + 1] - v[a + 1], uz = v[b + 2] - v[a + 2];
      const wx = v[c] - v[a], wy = v[c + 1] - v[a + 1], wz = v[c + 2] - v[a + 2];
      const gx = uy * wz - uz * wy, gy = uz * wx - ux * wz, gz = ux * wy - uy * wx;
      const cx = (v[a] + v[b] + v[c]) / 3, cyy = (v[a + 1] + v[b + 1] + v[c + 1]) / 3, cz = (v[a + 2] + v[b + 2] + v[c + 2]) / 3;
      const ge = cellSize * 0.5;
      const dx = field(cx + ge, cyy, cz) - field(cx - ge, cyy, cz);
      const dy = field(cx, cyy + ge, cz) - field(cx, cyy - ge, cz);
      const dz = field(cx, cyy, cz + ge) - field(cx, cyy, cz - ge);
      total++;
      if (gx * dx + gy * dy + gz * dz > 0) ok++;
    }
    const pct = (100 * ok / total);
    if (pct < 99) {
      err('seed ' + seed + ': WINDING FAIL — only ' + pct.toFixed(1) + '% of triangles face outward, skipping');
      continue;
    }
    out('  winding: ' + pct.toFixed(2) + '% outward (' + ok + '/' + total + ')');
  }

  const colors = bakeAlbedo(p, pl, F, mesh.verts, normals);
  const triCount = mesh.tris.length / 3;
  const dir = writePackage(seed, p, mesh, normals, colors, pl.geoR, triCount);
  if (!dir) { err('seed ' + seed + ': package write FAILED'); continue; }

  const prev = renderPreview(mesh.verts, mesh.tris, normals, colors, pl.geoR, 420, [-2.356, -0.9, 0.6], 0.35);
  const png = pngEncode(prev.W, prev.H, prev.rgba);
  if (!__fs_write(dir + '/preview.png.b64', base64(png))) err('seed ' + seed + ': preview write failed');

  out('nug_' + seed + ': ' + nVerts + ' verts, ' + triCount + ' tris, geoR=' + pl.geoR.toFixed(2)
    + ', dna{len=' + p.length + ' girth=' + p.girth + ' calyx=' + p.calyxCount + ' leaves=' + p.leafCount
    + ' purple=' + p.purple + '} in ' + (Date.now() - t0) + 'ms -> ' + dir);
}
out('done');
