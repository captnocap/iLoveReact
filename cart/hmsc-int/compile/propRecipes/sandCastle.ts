import { box, cylinder8, hx, type PropPartSpec } from '../../game/kinds/propModels';

import { type PropKindDefinition } from '../../game/kinds/props';

export const sandCastleDef: PropKindDefinition = {
  kind: 'sandCastle',
  label: 'Sand Castle',
  solid: true,
  footprintRadiusMeters: 0.4,
  heightMeters: 0.5,
  tileKind: 'wall',
  trafficControl: 'none',
  coverClass: 'none',
};

export function sandCastleParts(): PropPartSpec[] {
  const sand = hx('#d8c08a');
  const sandDark = hx('#c0a870');
  const parts: PropPartSpec[] = [box([0, 0.15, 0], [0.45, 0.3, 0.45], sand)];
  for (const [x, z] of [[-0.22, -0.22], [0.22, -0.22], [-0.22, 0.22], [0.22, 0.22]] as const) {
    parts.push(cylinder8([x, 0.21, z], 0.09, 0.42, sand));
    parts.push(cylinder8([x, 0.45, z], 0.055, 0.07, sandDark));
  }
  parts.push(box([0, 0.34, 0], [0.3, 0.18, 0.3], sandDark));
  parts.push(box([0, 0.1, -0.235], [0.12, 0.2, 0.03], hx('#8a7548')));
  return parts;
}
