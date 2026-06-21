// FlowerHead — tiny crossed cards for flower tops that ride the grass wind.
//
// This is intentionally not a sphere. It uses the "~grass~" foliage pipeline, so
// every vertex gets the same tip-weighted sway as a blade tip. UVs are offset into
// the grass shader's flower style band: u/v 10..11. The fragment shader cuts each
// card into a round colored head using the per-instance color.
import { mesh, type GeometryData, type Vec3 } from './_util';

export type FlowerHeadParams = {
  /** crossed cards around Y */
  cards: number;
  /** local card radius before instance scale */
  radius: number;
};

export const FLOWER_HEAD_DEFAULTS: FlowerHeadParams = { cards: 3, radius: 1 };

export function generate(p: FlowerHeadParams): GeometryData {
  const g = mesh();
  const count = Math.max(1, Math.floor(p.cards));
  const r = Math.max(0.01, p.radius);
  const u0 = 10, u1 = 11, v0 = 10, v1 = 11;

  for (let b = 0; b < count; b += 1) {
    const theta = ((b + 0.5) / count) * Math.PI;
    const dx = Math.cos(theta);
    const dz = Math.sin(theta);
    const n: Vec3 = [dz, 0, -dx];
    const nb: Vec3 = [-dz, 0, dx];
    const bl: Vec3 = [-dx * r, -r, -dz * r];
    const br: Vec3 = [dx * r, -r, dz * r];
    const tr: Vec3 = [dx * r, r, dz * r];
    const tl: Vec3 = [-dx * r, r, -dz * r];

    g.tri(bl, n, [u0, v0], br, n, [u1, v0], tr, n, [u1, v1]);
    g.tri(bl, n, [u0, v0], tr, n, [u1, v1], tl, n, [u0, v1]);
    g.tri(bl, nb, [u0, v0], tr, nb, [u1, v1], br, nb, [u1, v0]);
    g.tri(bl, nb, [u0, v0], tl, nb, [u0, v1], tr, nb, [u1, v1]);
  }

  return g.build();
}
