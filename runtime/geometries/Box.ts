// Box — sharp-edged axis-aligned box, hard normals, unwrapped UVs.
// Byte-equivalent port of the old native generateBox (framework/gpu/3d.zig).
import { mesh, type GeometryData } from './_util';

export type BoxParams = { width: number; height: number; depth: number };
export const BOX_DEFAULTS: BoxParams = { width: 1, height: 1, depth: 1 };

export function generate(p: BoxParams): GeometryData {
  const hx = p.width * 0.5;
  const hy = p.height * 0.5;
  const hz = p.depth * 0.5;
  const g = mesh();
  // Corners run world bottom→top (BL,BR,TR,TL) per face; matches Zig addFace.
  g.face([-hx, -hy, hz], [hx, -hy, hz], [hx, hy, hz], [-hx, hy, hz], [0, 0, 1]); // front
  g.face([hx, -hy, -hz], [-hx, -hy, -hz], [-hx, hy, -hz], [hx, hy, -hz], [0, 0, -1]); // back
  g.face([hx, -hy, hz], [hx, -hy, -hz], [hx, hy, -hz], [hx, hy, hz], [1, 0, 0]); // right
  g.face([-hx, -hy, -hz], [-hx, -hy, hz], [-hx, hy, hz], [-hx, hy, -hz], [-1, 0, 0]); // left
  g.face([-hx, hy, hz], [hx, hy, hz], [hx, hy, -hz], [-hx, hy, -hz], [0, 1, 0]); // top
  g.face([-hx, -hy, -hz], [hx, -hy, -hz], [hx, -hy, hz], [-hx, -hy, hz], [0, -1, 0]); // bottom
  return g.build();
}
