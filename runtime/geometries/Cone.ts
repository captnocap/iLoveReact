// Cone — segment-based side wall tapering to an apex, with a flat bottom cap.
// Byte-equivalent port of the old native generateCone (default 24 segments).
import { mesh, normalize, type GeometryData, type Vec3 } from './_util';

export type ConeParams = { radius: number; height: number; segments: number };
export const CONE_DEFAULTS: ConeParams = { radius: 0.5, height: 1, segments: 24 };

const PI = Math.PI;

export function generate(p: ConeParams): GeometryData {
  const { radius: r, height, segments } = p;
  const hy = height * 0.5;
  const slope = Math.abs(height) > 0.001 ? r / height : 1.0;
  const apex: Vec3 = [0, hy, 0];
  const g = mesh();
  for (let j = 0; j < segments; j++) {
    const a1 = (2 * PI * j) / segments;
    const a2 = (2 * PI * (j + 1)) / segments;
    const mid = (a1 + a2) * 0.5;
    const c1 = Math.cos(a1), s1 = Math.sin(a1);
    const c2 = Math.cos(a2), s2 = Math.sin(a2);
    const a: Vec3 = [r * c1, -hy, r * s1];
    const b: Vec3 = [r * c2, -hy, r * s2];
    const n1 = normalize(c1, slope, s1);
    const n2 = normalize(c2, slope, s2);
    const na = normalize(Math.cos(mid), slope, Math.sin(mid));
    g.tri(a, n1, [0, 0], apex, na, [0.5, 1], b, n2, [1, 0]);
    g.triFlat([0, -hy, 0], a, b, [0, -1, 0]); // bottom cap
  }
  return g.build();
}
