// BushClump — a clump of crossed cards that splay OUTWARD into a rounded bush,
// the foliage sibling of GrassBlade. Grass blades stand straight up; a bush wants
// volume, so each card leans out from the centre (tip pushed along its own compass
// direction) and the cards fan a full circle — the silhouette reads as a leafy
// shrub, not a tuft. The foliage scene3d pipeline (same as grass) cuts each card
// into wisps + gradients it dark-root→bright-tip + sways it in wind. 1 unit tall;
// the per-instance scale sets the real size. Double-sided (both windings).
import { mesh, type GeometryData, type Vec3 } from './_util';

export type BushClumpParams = {
  /** crossed cards in the clump (≈5 reads as a full rounded bush) */
  cards: number;
  /** card width at the root, in unit space */
  width: number;
  /** tip width as a fraction of root width */
  tipTaper: number;
  /** how far the tip leans outward from the clump centre (0 = straight up) */
  splay: number;
};

export const BUSH_CLUMP_DEFAULTS: BushClumpParams = { cards: 5, width: 0.5, tipTaper: 0.3, splay: 0.5 };

export function generate(p: BushClumpParams): GeometryData {
  const g = mesh();
  const halfW = p.width * 0.5;
  const tipHalfW = halfW * p.tipTaper;
  const count = Math.max(1, Math.floor(p.cards));

  for (let b = 0; b < count; b += 1) {
    // Fan the cards a FULL circle (grass uses a half-turn) so the bush has volume
    // from every side; the 0.5 offset keeps a card off each world axis.
    const theta = ((b + 0.5) / count) * Math.PI * 2;
    const dx = Math.cos(theta);
    const dz = Math.sin(theta);
    // Card lies in the vertical plane through `dir`; width spans the horizontal
    // perpendicular, face normal points outward-and-up.
    const perpX = -dz;
    const perpZ = dx;
    const n: Vec3 = [dx, 0.6, dz];
    const nBack: Vec3 = [-dx, 0.6, -dz];
    const tipX = dx * p.splay;
    const tipZ = dz * p.splay;

    const bl: Vec3 = [-perpX * halfW, 0, -perpZ * halfW];
    const br: Vec3 = [perpX * halfW, 0, perpZ * halfW];
    const tr: Vec3 = [tipX + perpX * tipHalfW, 1, tipZ + perpZ * tipHalfW];
    const tl: Vec3 = [tipX - perpX * tipHalfW, 1, tipZ - perpZ * tipHalfW];

    // Front (v = 0 root, 1 tip; u across the card).
    g.tri(bl, n, [0, 0], br, n, [1, 0], tr, n, [1, 1]);
    g.tri(bl, n, [0, 0], tr, n, [1, 1], tl, n, [0, 1]);
    // Back (reversed winding + flipped normal).
    g.tri(bl, nBack, [0, 0], tr, nBack, [1, 1], br, nBack, [1, 0]);
    g.tri(bl, nBack, [0, 0], tl, nBack, [0, 1], tr, nBack, [1, 1]);
  }

  return g.build();
}
