// Cylinder — segment-based side wall with flat top + bottom caps. (An open-ended
// tube or a domed cap is a sibling file, not a flag.) Byte-equivalent port of the
// old native generateCylinder (default 24 segments).
import { mesh, type GeometryData, type Vec3 } from './_util';

export type CylinderParams = { radius: number; height: number; segments: number };
export const CYLINDER_DEFAULTS: CylinderParams = { radius: 0.5, height: 1, segments: 24 };

const PI = Math.PI;

export function generate(p: CylinderParams): GeometryData {
  const { radius: r, height, segments } = p;
  const hy = height * 0.5;
  const g = mesh();
  for (let j = 0; j < segments; j++) {
    const a1 = (2 * PI * j) / segments;
    const a2 = (2 * PI * (j + 1)) / segments;
    const c1 = Math.cos(a1), s1 = Math.sin(a1);
    const c2 = Math.cos(a2), s2 = Math.sin(a2);
    const a: Vec3 = [r * c1, -hy, r * s1];
    const b: Vec3 = [r * c2, -hy, r * s2];
    const c: Vec3 = [r * c2, hy, r * s2];
    const d: Vec3 = [r * c1, hy, r * s1];
    const n1: Vec3 = [c1, 0, s1];
    const n2: Vec3 = [c2, 0, s2];
    g.tri(a, n1, [0, 0], d, n1, [0, 1], c, n2, [1, 1]);
    g.tri(a, n1, [0, 0], c, n2, [1, 1], b, n2, [1, 0]);
    // Top cap: top-center + the TWO TOP-RING vertices (c, d). The original Zig
    // generateCylinder (which this file was a byte-equivalent port of) used b, a
    // here — both BOTTOM-ring vertices — which built 24 diagonal triangles fanning
    // from top-center down to the bottom rim instead of a flat top cap. From most
    // side views the bogus cone is hidden inside the cylinder shell, but looking
    // into the open top (or any path where the cone's outward face becomes visible
    // through the side wall's grazing edge) shows straight through the missing top.
    g.triFlat([0, hy, 0], c, d, [0, 1, 0]); // top cap
    g.triFlat([0, -hy, 0], a, b, [0, -1, 0]); // bottom cap
  }
  return g.build();
}
