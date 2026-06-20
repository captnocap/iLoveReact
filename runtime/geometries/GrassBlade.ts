// GrassBlade — a clump of crossed quads that reads as a tuft of grass blades.
//
// This is the FluffyGrass move (github.com/thebenezer/FluffyGrass): a blade is not
// sculpted geometry, it is a cheap card the SHADER paints — alpha-cut into wisps,
// gradiented dark-root→bright-tip, and bent by wind. So the geometry here is
// deliberately dumb: a few flat quads crossed around Y, each UV-mapped so v runs
// 0 at the ROOT (y=0) to 1 at the TIP (y=1). The grass scene3d pipeline reads that
// v to drive the gradient and to weight wind sway toward the tip (root stays
// planted). 1 unit tall — the per-instance scale sets the real height in metres,
// so a single interned blade mesh serves every grass cell (geometry_intern rule:
// unit params + scale transform, never per-instance geometry).
//
// Each quad is emitted double-sided (both windings, flipped normals) because the
// scene3d pipeline back-face culls and a blade must read from every direction.
import { mesh, type GeometryData, type Vec3 } from './_util';

export type GrassBladeParams = {
  /** how many crossed quads make the clump (3 = a fan from any angle) */
  blades: number;
  /** blade width at the root, in unit space (height is 1) */
  width: number;
  /** tip width as a fraction of root width — the taper that points the blade */
  tipTaper: number;
};

export const GRASS_BLADE_DEFAULTS: GrassBladeParams = { blades: 3, width: 0.14, tipTaper: 0.25 };

export function generate(p: GrassBladeParams): GeometryData {
  const g = mesh();
  const halfW = p.width * 0.5;
  const tipHalfW = halfW * p.tipTaper;
  const count = Math.max(1, Math.floor(p.blades));

  for (let b = 0; b < count; b += 1) {
    // Even spread of the quads around Y; the 0.5 offset keeps an odd count from
    // putting a quad flat along a world axis.
    const theta = ((b + 0.5) / count) * Math.PI;
    const dx = Math.cos(theta);
    const dz = Math.sin(theta);
    // Quad lies in the vertical plane through `dir`; its face normal is the
    // horizontal perpendicular cross(up, dir).
    const n: Vec3 = [dz, 0, -dx];
    const nBack: Vec3 = [-dz, 0, dx];

    const bl: Vec3 = [-dx * halfW, 0, -dz * halfW];
    const br: Vec3 = [dx * halfW, 0, dz * halfW];
    const tr: Vec3 = [dx * tipHalfW, 1, dz * tipHalfW];
    const tl: Vec3 = [-dx * tipHalfW, 1, -dz * tipHalfW];

    // Front face: v = 0 at root, 1 at tip; u spans the blade width.
    g.tri(bl, n, [0, 0], br, n, [1, 0], tr, n, [1, 1]);
    g.tri(bl, n, [0, 0], tr, n, [1, 1], tl, n, [0, 1]);
    // Back face: reversed winding + flipped normal so the clump is two-sided.
    g.tri(bl, nBack, [0, 0], tr, nBack, [1, 1], br, nBack, [1, 0]);
    g.tri(bl, nBack, [0, 0], tl, nBack, [0, 1], tr, nBack, [1, 1]);
  }

  return g.build();
}
