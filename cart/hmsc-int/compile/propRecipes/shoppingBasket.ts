import { box, hx, type PropPartSpec } from '../../game/kinds/propModels';
import { type PropKindDefinition } from '../../game/kinds/props';

export const shoppingBasketDef: PropKindDefinition = {
  kind: 'shoppingBasket',
  label: 'Shopping Basket',
  solid: true,
  footprintRadiusMeters: 0.18,
  heightMeters: 0.25,
  tileKind: 'wall',
  trafficControl: 'none',
};

const PLASTIC = hx('#e8b84a');
const HANDLE = hx('#1a1c1e');

export function shoppingBasketParts(): PropPartSpec[] {
  return [
    // basket base
    box([0, 0.03, 0], [0.32, 0.04, 0.28], PLASTIC),
    // lower tapered sides
    box([0, 0.1, 0.12], [0.32, 0.12, 0.02], PLASTIC),
    box([0, 0.1, -0.12], [0.32, 0.12, 0.02], PLASTIC),
    box([0.14, 0.1, 0], [0.02, 0.12, 0.24], PLASTIC),
    box([-0.14, 0.1, 0], [0.02, 0.12, 0.24], PLASTIC),
    // top rim
    box([0, 0.18, 0], [0.36, 0.03, 0.32], PLASTIC),
    // handles (two arcs approximated by boxes)
    box([0.16, 0.24, 0], [0.02, 0.08, 0.24], HANDLE, [0, 0, -20]),
    box([-0.16, 0.24, 0], [0.02, 0.08, 0.24], HANDLE, [0, 0, 20]),
  ];
}
