// Vertex assembly for @reactjit/geometries generators.
//
// The framework vertex (framework/gpu/3d.zig `Vertex`) is 8 interleaved floats,
// non-indexed triangle list:
//
//   [ px, py, pz,  nx, ny, nz,  u, v ]   // position3 · normal3 · uv2
//
// A generator builds a `Mesh`, pushes triangles, and returns `.build()`. The
// helpers below mirror the Zig assembly primitives 1:1 (addFace winding/UVs,
// addTri, addTriFlat) so a ported shape is byte-equivalent to the old native one.

export type Vec2 = readonly [number, number];
export type Vec3 = readonly [number, number, number];

export type GeometryData = {
  /** count*8 floats, in [px,py,pz, nx,ny,nz, u,v] order. */
  positions: Float32Array;
  /** vertex count (triangles = count / 3). */
  count: number;
  /** tight unscaled bounding radius; the framework culls off this × max(scale). */
  bounds: { radius: number };
};

export function normalize(x: number, y: number, z: number): Vec3 {
  const len = Math.sqrt(x * x + y * y + z * z);
  if (len < 1e-6) return [0, 0, 0];
  return [x / len, y / len, z / len];
}

export class Mesh {
  private v: number[] = [];
  private maxR2 = 0;

  /** Push one vertex (position, normal, uv). */
  vert(p: Vec3, n: Vec3, uv: Vec2): void {
    this.v.push(p[0], p[1], p[2], n[0], n[1], n[2], uv[0], uv[1]);
    const r2 = p[0] * p[0] + p[1] * p[1] + p[2] * p[2];
    if (r2 > this.maxR2) this.maxR2 = r2;
  }

  /** A triangle with per-corner normals + UVs (mirrors Zig addTri). */
  tri(
    a: Vec3, na: Vec3, ua: Vec2,
    b: Vec3, nb: Vec3, ub: Vec2,
    c: Vec3, nc: Vec3, uc: Vec2,
  ): void {
    this.vert(a, na, ua);
    this.vert(b, nb, ub);
    this.vert(c, nc, uc);
  }

  /** Flat-shaded triangle: one normal, default UVs (mirrors Zig addTriFlat). */
  triFlat(a: Vec3, b: Vec3, c: Vec3, n: Vec3): void {
    this.tri(a, n, [0, 0], b, n, [1, 0], c, n, [1, 1]);
  }

  /**
   * A quad as two triangles with a single face normal. Mirrors Zig addFace
   * exactly: corners run world bottom→top (BL,BR,TR,TL), V is flipped so a
   * texture stays upright on the face, winding is [0,1,2, 0,2,3].
   *
   * `pinUv` collapses all four corner UVs to a single texel so the face samples
   * one flat color instead of stretching the whole texture across it — the
   * "this face isn't textured" path (e.g. the thin edge of a sign). Omit it for
   * the normal upright 0..1 mapping.
   */
  face(v1: Vec3, v2: Vec3, v3: Vec3, v4: Vec3, n: Vec3, pinUv?: Vec2): void {
    const corners: Vec3[] = [v1, v2, v3, v4];
    const uvs: Vec2[] = pinUv ? [pinUv, pinUv, pinUv, pinUv] : [[0, 1], [1, 1], [1, 0], [0, 0]];
    const order = [0, 1, 2, 0, 2, 3];
    for (const ti of order) this.vert(corners[ti], n, uvs[ti]);
  }

  build(): GeometryData {
    return {
      positions: new Float32Array(this.v),
      count: this.v.length / 8,
      bounds: { radius: Math.sqrt(this.maxR2) },
    };
  }
}

export function mesh(): Mesh {
  return new Mesh();
}
