import { box, hx, type Color, type PropPartSpec } from '../../game/kinds/propModels';

import { type PropKindDefinition } from '../../game/kinds/props';

export const bookStackDef: PropKindDefinition = {
  kind: 'bookStack',
  label: 'Books',
  solid: false,
  footprintRadiusMeters: 0.18,
  heightMeters: 0.38,
  tileKind: 'wall',
  trafficControl: 'none',
  mount: 'surface',
};

export function bookStackParts(): PropPartSpec[] {
  const covers: Color[] = [hx('#7a3b2a'), hx('#2e6f55'), hx('#3a5a8a'), hx('#a8893a')];
  const parts = covers.map((color, i) =>
    box([(i % 2) * 0.03 - 0.015, 0.04 + i * 0.075, (i % 3) * 0.02 - 0.02], [0.32, 0.07, 0.22], color, [0, (i * 17) % 30 - 15, 0]));
  parts.push(box([0.05, 0.34, 0], [0.3, 0.065, 0.21], hx('#8a3b5a'), [0, 24, 8]));
  return parts;
}
