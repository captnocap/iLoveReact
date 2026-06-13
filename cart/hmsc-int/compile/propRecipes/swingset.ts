import { box, cylinder8, hx, type PropPartSpec } from '../../game/kinds/propModels';
import { propKindDefinition } from '../../game/kinds/props';

import { type PropKindDefinition } from '../../game/kinds/props';

export const swingsetDef: PropKindDefinition = {
  kind: 'swingset',
  label: 'Swing Set',
  // Static A-frame with two hanging seats for now; the seats are sittable.
  // PHYSICS OPPORTUNITY (user, req_0640): swinging is a future dynamics
  // slice — the chain/seat pendulum wants the entity body system once
  // constrained bodies exist (today's bodies are free spheres only).
  solid: true,
  footprintRadiusMeters: 1.9,
  heightMeters: 2.5,
  tileKind: 'wall',
  trafficControl: 'none',
  seat: { pose: 'sit', seatHeightMeters: 0.55, capacity: 2 },
};

export function swingsetParts(): PropPartSpec[] {
  const def = propKindDefinition('swingset');
  const h = def.heightMeters;
  const halfSpan = def.footprintRadiusMeters * 0.9;
  const frame = hx('#c1272d');
  const chain = hx('#9aa1ab');
  const rubber = hx('#1a1c1e');
  const parts: PropPartSpec[] = [
    cylinder8([0, h - 0.06, 0], 0.06, halfSpan * 2 + 0.3, frame, [0, 0, 90]),
  ];
  for (const sx of [-1, 1]) {
    parts.push(box([sx * halfSpan, h / 2 - 0.05, -0.55], [0.09, h, 0.09], frame, [20, 0, 0]));
    parts.push(box([sx * halfSpan, h / 2 - 0.05, 0.55], [0.09, h, 0.09], frame, [-20, 0, 0]));
  }
  for (const sx of [-0.65, 0.65]) {
    parts.push(box([sx - 0.2, h - 0.95, 0], [0.025, 1.7, 0.025], chain));
    parts.push(box([sx + 0.2, h - 0.95, 0], [0.025, 1.7, 0.025], chain));
    parts.push(box([sx, h - 1.85, 0], [0.5, 0.05, 0.22], rubber));
  }
  return parts;
}
