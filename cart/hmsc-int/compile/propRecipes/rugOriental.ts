import { box, hx, type PropPartSpec } from '../../game/kinds/propModels';
import { type PropKindDefinition } from '../../game/kinds/props';

export const rugOrientalDef: PropKindDefinition = {
  kind: 'rugOriental',
  label: 'Oriental Rug',
  solid: true,
  footprintRadiusMeters: 1.0,
  heightMeters: 0.04,
  tileKind: 'wall',
  trafficControl: 'none',
  coverClass: 'soft',
};

export function rugOrientalParts(): PropPartSpec[] {
  const crimson = hx('#7d3b4a');
  const gold = hx('#c2a878');
  const teal = hx('#3a7d80');
  const fringe = hx('#d6c69a');
  const w = 2.0;
  const d = 1.4;
  const parts: PropPartSpec[] = [
    box([0, 0.02, 0], [w, 0.04, d], crimson),
    box([0, 0.04, 0], [w - 0.2, 0.015, d - 0.2], gold),
    box([0, 0.045, 0], [w - 0.6, 0.015, d - 0.6], teal),
    box([0, 0.05, 0], [w - 1.2, 0.015, d - 1.0], crimson),
  ];
  // fringe along the short edges
  const tasselW = 0.04;
  const tasselH = 0.025;
  const tasselD = 0.02;
  const count = 14;
  for (let i = 0; i < count; i++) {
    const z = -d / 2 + 0.05 + i * ((d - 0.1) / (count - 1));
    parts.push(box([w / 2 + 0.01, 0.03, z], [tasselW, tasselH, tasselD], fringe));
    parts.push(box([-w / 2 - 0.01, 0.03, z], [tasselW, tasselH, tasselD], fringe));
  }
  return parts;
}
