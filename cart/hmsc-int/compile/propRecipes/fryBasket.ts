import { box, hx, type PropPartSpec } from '../../game/kinds/propModels';
import { type PropKindDefinition } from '../../game/kinds/props';

export const fryBasketDef: PropKindDefinition = {
  kind: 'fryBasket',
  label: 'Fry Basket',
  solid: false,
  footprintRadiusMeters: 0.12,
  heightMeters: 0.14,
  tileKind: 'wall',
  trafficControl: 'none',
  mount: 'surface',
  coverClass: 'none',
};

export function fryBasketParts(): PropPartSpec[] {
  const metal = hx('#9aa1ab');
  const fry = hx('#d4a83a');
  const parts: PropPartSpec[] = [
    box([0, 0.02, 0], [0.24, 0.02, 0.18], metal),
    box([0, 0.07, 0], [0.22, 0.08, 0.02], fry),
    box([0, 0.07, 0], [0.02, 0.08, 0.16], fry),
    box([0, 0.09, 0], [0.24, 0.02, 0.02], metal),
  ];
  // fries sticking out at varied angles
  for (let i = 0; i < 7; i++) {
    const x = -0.07 + i * 0.023;
    const yaw = (i % 3 - 1) * 12;
    parts.push(box([x, 0.13, 0.02], [0.018, 0.08, 0.018], fry, [0, yaw, 0]));
  }
  return parts;
}
