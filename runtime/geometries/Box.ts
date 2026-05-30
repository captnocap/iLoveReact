// Box — sharp-edged axis-aligned box, hard normals, unwrapped UVs.
// Byte-equivalent port of the old native generateBox (framework/gpu/3d.zig).
import { mesh, type GeometryData, type Vec2 } from './_util';

// The six faces by name. A textured box declares which of these carry the
// texture; any face left out collapses its UVs to the capture's (0,0) corner
// texel, so it shows one flat color instead of the whole texture stretched onto
// a thin edge. Omitting `texturedFaces` textures all six (the original look).
export type BoxFace = 'front' | 'back' | 'right' | 'left' | 'top' | 'bottom';

export type BoxParams = {
  width: number;
  height: number;
  depth: number;
  /** Faces that sample the full 0..1 texture; the rest pin to texel (0,0). */
  texturedFaces?: BoxFace[];
};
export const BOX_DEFAULTS: BoxParams = { width: 1, height: 1, depth: 1 };

const PIN: Vec2 = [0, 0];

export function generate(p: BoxParams): GeometryData {
  const hx = p.width * 0.5;
  const hy = p.height * 0.5;
  const hz = p.depth * 0.5;
  // undefined → every face textured (back-compat). Otherwise a face textures
  // only if it's listed; unlisted faces pin to (0,0).
  const faces = p.texturedFaces;
  const pin = (face: BoxFace): Vec2 | undefined => (faces && !faces.includes(face) ? PIN : undefined);
  const g = mesh();
  // Corners run world bottom→top (BL,BR,TR,TL) per face; matches Zig addFace.
  g.face([-hx, -hy, hz], [hx, -hy, hz], [hx, hy, hz], [-hx, hy, hz], [0, 0, 1], pin('front')); // front
  g.face([hx, -hy, -hz], [-hx, -hy, -hz], [-hx, hy, -hz], [hx, hy, -hz], [0, 0, -1], pin('back')); // back
  g.face([hx, -hy, hz], [hx, -hy, -hz], [hx, hy, -hz], [hx, hy, hz], [1, 0, 0], pin('right')); // right
  g.face([-hx, -hy, -hz], [-hx, -hy, hz], [-hx, hy, hz], [-hx, hy, -hz], [-1, 0, 0], pin('left')); // left
  g.face([-hx, hy, hz], [hx, hy, hz], [hx, hy, -hz], [-hx, hy, -hz], [0, 1, 0], pin('top')); // top
  g.face([-hx, -hy, -hz], [hx, -hy, -hz], [hx, -hy, hz], [-hx, -hy, hz], [0, -1, 0], pin('bottom')); // bottom
  return g.build();
}
