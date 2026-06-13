import { box, cylinder8, hx, sphere, STEEL, STEEL_DARK, WHITE, type PropPartSpec } from '../../game/kinds/propModels';
import { propKindDefinition } from '../../game/kinds/props';

import { type PropKindDefinition } from '../../game/kinds/props';

export const radioTowerDef: PropKindDefinition = {
  kind: 'radioTower',
  label: 'Radio Tower',
  // Real small-market lattice tower ~30m × 1.15. The footprint is the leg
  // square's half-width.
  solid: true,
  footprintRadiusMeters: 2.2,
  heightMeters: 34,
  tileKind: 'wall',
  trafficControl: 'none',
};

export function radioTowerParts(): PropPartSpec[] {
  const { heightMeters: h, footprintRadiusMeters: r } = propKindDefinition('radioTower');
  const latticeTop = h * 0.88;
  const baseHalf = r * 0.82;
  const topHalf = r * 0.16;
  const red = hx('#c2362f');
  const parts: PropPartSpec[] = [];
  const segments = 3;
  for (let i = 0; i < segments; i += 1) {
    const y0 = (latticeTop * i) / segments;
    const segH = latticeTop / segments;
    const half = baseHalf + (topHalf - baseHalf) * ((i + 0.5) / segments);
    const paint = i % 2 === 0 ? red : WHITE;
    for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]] as const) {
      parts.push(box([half * sx, y0 + segH / 2, half * sz], [0.2, segH, 0.2], paint));
    }
    // brace frame at the segment top
    parts.push(box([0, y0 + segH, 0], [half * 2 + 0.2, 0.14, 0.14], STEEL_DARK));
    parts.push(box([0, y0 + segH, 0], [0.14, 0.14, half * 2 + 0.2], STEEL_DARK));
  }
  parts.push(cylinder8([0, latticeTop + (h - latticeTop) / 2, 0], 0.09, h - latticeTop, STEEL));
  parts.push(sphere([0, h, 0], [0.5, 0.5, 0.5], hx('#ff3b30'))); // aviation beacon
  return parts;
}
