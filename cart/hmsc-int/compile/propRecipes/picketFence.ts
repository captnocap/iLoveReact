import { box, hx, WHITE, type PropPartSpec } from '../../game/kinds/propModels';
import { propKindDefinition } from '../../game/kinds/props';

import { type PropKindDefinition } from '../../game/kinds/props';

export const picketFenceDef: PropKindDefinition = {
  kind: 'picketFence',
  label: 'Picket Fence',
  // A white 2.5m garden segment — same yaw-aware thin AABB as 'fence'.
  solid: true,
  footprintRadiusMeters: 1.35,
  heightMeters: 1.1,
  tileKind: 'wall',
  trafficControl: 'none',
};

export function picketFenceParts(): PropPartSpec[] {
  const def = propKindDefinition('picketFence');
  const h = def.heightMeters;
  const halfSpan = def.footprintRadiusMeters * 0.95;
  const white = WHITE;
  const shade = hx('#d8dade');
  const parts: PropPartSpec[] = [
    box([0, h * 0.72, 0], [halfSpan * 2, 0.09, 0.04], shade),
    box([0, h * 0.28, 0], [halfSpan * 2, 0.09, 0.04], shade),
  ];
  const pickets = 7;
  for (let i = 0; i < pickets; i += 1) {
    const x = -halfSpan + (i / (pickets - 1)) * halfSpan * 2;
    parts.push(box([x, h * 0.48, -0.01], [0.1, h * 0.92, 0.025], white));
    parts.push(box([x, h * 0.97, -0.01], [0.07, h * 0.08, 0.025], white, [0, 0, 45]));
  }
  return parts;
}
