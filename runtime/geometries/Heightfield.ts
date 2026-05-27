// Heightfield — a cols×rows grid of corner heights → a smooth-normalled terrain
// surface plus a perimeter skirt dropped to `base` (so cliffs aren't see-through).
// This is ONE heightfield approach (flat array + optional travelling wave); a
// heightmap-texture-driven or erosion-baked field is a sibling file, not a flag.
//
// The optional `wave` makes the surface time-dependent — that's the canonical
// DYNAMIC generator: `t` is an explicit param so the function stays pure. A wave
// heightfield re-generates on `t` change (the V8-fallback path), NOT per frame for
// free; a static one (amplitude 0) interns once like any other geometry.
//
// Byte-equivalent port of the old native generateHeightfield (the Zig version
// sourced `t` from milliTimestamp internally; here the caller passes it).
import { mesh, normalize, type GeometryData, type Vec3 } from './_util';

export type HeightfieldWave = {
  amplitude: number;
  length: number;
  speed: number;
  dirX: number;
  dirZ: number;
  phase: number;
};
export const WAVE_NONE: HeightfieldWave = { amplitude: 0, length: 0, speed: 0, dirX: 1, dirZ: 0, phase: 0 };

export type HeightfieldParams = {
  heights: number[] | Float32Array;
  cols: number;
  rows: number;
  width: number;
  depth: number;
  base: number;
  wave: HeightfieldWave;
  /** animation clock in seconds; 0 for a static field. */
  t: number;
};
export const HEIGHTFIELD_DEFAULTS: Omit<HeightfieldParams, 'heights' | 'cols' | 'rows'> = {
  width: 1,
  depth: 1,
  base: 0,
  wave: WAVE_NONE,
  t: 0,
};

const TAU = Math.PI * 2;

function waveHeight(w: HeightfieldWave, x: number, z: number, t: number): number {
  if (Math.abs(w.amplitude) <= 0.0001 || w.length <= 0.0001) return 0;
  const dlen = Math.sqrt(w.dirX * w.dirX + w.dirZ * w.dirZ);
  const dx = dlen > 0.0001 ? w.dirX / dlen : 1;
  const dz = dlen > 0.0001 ? w.dirZ / dlen : 0;
  const cycles = (x * dx + z * dz) / w.length + w.phase + t * w.speed;
  return Math.sin(cycles * TAU) * w.amplitude;
}

export function generate(p: HeightfieldParams): GeometryData {
  const { cols, rows, width: w, depth: h, base, wave, t } = p;
  const hs = p.heights;
  const g = mesh();
  if (cols < 2 || rows < 2) return g.build();
  if (hs.length !== cols * rows) return g.build();

  const dx = w / (cols - 1);
  const dz = h / (rows - 1);
  const x0 = -w * 0.5;
  const z0 = -h * 0.5;
  const cf = cols - 1;
  const rf = rows - 1;

  // World-space sample at grid (i,j), height = stored + wave.
  const at = (i: number, j: number): Vec3 => {
    const x = x0 + i * dx;
    const z = z0 + j * dz;
    return [x, hs[j * cols + i] + waveHeight(wave, x, z, t), z];
  };
  const drop = (pt: Vec3): Vec3 => [pt[0], base, pt[2]];

  // Height at a CLAMPED grid index — used for central-difference normals.
  const heightAt = (i: number, j: number): number => {
    const ci = Math.min(Math.max(i, 0), cols - 1);
    const cj = Math.min(Math.max(j, 0), rows - 1);
    const x = x0 + ci * dx;
    const z = z0 + cj * dz;
    return hs[cj * cols + ci] + waveHeight(wave, x, z, t);
  };
  const normalAt = (i: number, j: number): Vec3 => {
    const hl = heightAt(i - 1, j);
    const hr = heightAt(i + 1, j);
    const hu = heightAt(i, j - 1);
    const hd = heightAt(i, j + 1);
    return normalize(-(hr - hl) / (2 * dx), 1.0, -(hd - hu) / (2 * dz));
  };

  // Top surface — wound to face +Y (up); a -Y top renders black from above.
  for (let j = 0; j + 1 < rows; j++) {
    for (let i = 0; i + 1 < cols; i++) {
      const pa = at(i, j), pb = at(i + 1, j), pc = at(i + 1, j + 1), pd = at(i, j + 1);
      const na = normalAt(i, j), nb = normalAt(i + 1, j), nc = normalAt(i + 1, j + 1), nd = normalAt(i, j + 1);
      const ua: [number, number] = [i / cf, j / rf];
      const ub: [number, number] = [(i + 1) / cf, j / rf];
      const uc: [number, number] = [(i + 1) / cf, (j + 1) / rf];
      const ud: [number, number] = [i / cf, (j + 1) / rf];
      g.vert(pa, na, ua); g.vert(pc, nc, uc); g.vert(pb, nb, ub);
      g.vert(pa, na, ua); g.vert(pd, nd, ud); g.vert(pc, nc, uc);
    }
  }

  // Perimeter skirt — seal each boundary edge down to `base`, faces outward.
  const skirt = (a: Vec3, b: Vec3, c: Vec3, d: Vec3, n: Vec3) => {
    const uv: [number, number] = [0, 0];
    g.vert(a, n, uv); g.vert(b, n, uv); g.vert(c, n, uv);
    g.vert(a, n, uv); g.vert(c, n, uv); g.vert(d, n, uv);
  };
  for (let i = 0; i + 1 < cols; i++) {
    const tn0 = at(i, 0), tn1 = at(i + 1, 0);
    if (tn0[1] > base || tn1[1] > base) skirt(drop(tn1), drop(tn0), tn0, tn1, [0, 0, -1]); // north
    const js = rows - 1;
    const ts0 = at(i, js), ts1 = at(i + 1, js);
    if (ts0[1] > base || ts1[1] > base) skirt(drop(ts0), drop(ts1), ts1, ts0, [0, 0, 1]); // south
  }
  for (let j = 0; j + 1 < rows; j++) {
    const tw0 = at(0, j), tw1 = at(0, j + 1);
    if (tw0[1] > base || tw1[1] > base) skirt(drop(tw0), drop(tw1), tw1, tw0, [-1, 0, 0]); // west
    const ie = cols - 1;
    const te0 = at(ie, j), te1 = at(ie, j + 1);
    if (te0[1] > base || te1[1] > base) skirt(drop(te1), drop(te0), te0, te1, [1, 0, 0]); // east
  }

  return g.build();
}
