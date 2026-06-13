import { cylinder8, cylinder16, hx, NEAR_BLACK, type PropPartSpec } from '../../game/kinds/propModels';
import { propKindDefinition } from '../../game/kinds/props';

import { type PropKindDefinition } from '../../game/kinds/props';

export const tireDef: PropKindDefinition = {
  kind: 'tire',
  label: 'Tire',
  // A standing car tire (Ø0.66 × 1.15) — it rolls when kicked.
  solid: true,
  footprintRadiusMeters: 0.38,
  heightMeters: 0.76,
  tileKind: 'wall',
  trafficControl: 'none',
  dynamics: { bodyRadiusMeters: 0.38, restitution: 0.45 },
};

export function tireParts(): PropPartSpec[] {
  const R = propKindDefinition('tire').heightMeters / 2;
  return [
    cylinder16([0, R, 0], R, R * 0.68, NEAR_BLACK, [90, 0, 0]),
    cylinder16([0, R, 0], R * 0.46, R * 0.72, hx('#6c727b'), [90, 0, 0]),
    cylinder8([0, R, 0], R * 0.14, R * 0.76, hx('#52565d'), [90, 0, 0]),
  ];
}
