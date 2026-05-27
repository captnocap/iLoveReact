// Plane — a single flat quad in the XZ plane. Note: its winding makes it
// single-sided; a top-down camera back-face-culls it (which is why floors use
// thin boxes, not planes — see scene3d_plane_culling). Byte-equivalent port of
// the old native generatePlane.
import { mesh, type GeometryData } from './_util';

export type PlaneParams = { width: number; depth: number };
export const PLANE_DEFAULTS: PlaneParams = { width: 1, depth: 1 };

export function generate(p: PlaneParams): GeometryData {
  const hx = p.width * 0.5;
  const hz = p.depth * 0.5;
  const g = mesh();
  g.face([-hx, 0, -hz], [hx, 0, -hz], [hx, 0, hz], [-hx, 0, hz], [0, 1, 0]);
  return g.build();
}
