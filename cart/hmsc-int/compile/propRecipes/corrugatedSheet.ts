import { box, hx, RUST, type PropPartSpec } from '../../game/kinds/propModels';
import { propKindDefinition } from '../../game/kinds/props';

import { type PropKindDefinition } from '../../game/kinds/props';

export const corrugatedSheetDef: PropKindDefinition = {
  kind: 'corrugatedSheet',
  label: 'Corrugated Sheet',
  // A leaning zinc sheet; thin span along local X (yaw-aware AABB).
  solid: true,
  footprintRadiusMeters: 1.0,
  heightMeters: 2.3,
  tileKind: 'wall',
  trafficControl: 'none',
  coverClass: 'hard',
};

export function corrugatedSheetParts(): PropPartSpec[] {
  const h = propKindDefinition('corrugatedSheet').heightMeters;
  const zinc = hx('#b8bcb6');
  const parts: PropPartSpec[] = [
    box([0, h * 0.49, 0], [1.9, h, 0.05], zinc, [14, 0, 0]),
    box([-0.35, h * 0.6, -0.045], [0.7, h * 0.3, 0.02], RUST, [14, 0, 0]),
  ];
  for (const x of [-0.6, 0, 0.6]) parts.push(box([x, h * 0.49, -0.04], [0.09, h * 0.96, 0.03], hx('#a0a49e'), [14, 0, 0]));
  return parts;
}
