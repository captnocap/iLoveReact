import { box, cylinder8, hx, type PropPartSpec } from '../../game/kinds/propModels';
import { type PropKindDefinition } from '../../game/kinds/props';

export const shoppingCartDef: PropKindDefinition = {
  kind: 'shoppingCart',
  label: 'Shopping Cart',
  solid: true,
  footprintRadiusMeters: 0.35,
  heightMeters: 0.85,
  tileKind: 'wall',
  trafficControl: 'none',
};

const METAL = hx('#9aa1ab');
const DARK = hx('#6c727b');
const WHEEL = hx('#1a1c1e');
const PLASTIC = hx('#c2362f');

export function shoppingCartParts(): PropPartSpec[] {
  return [
    // base frame
    box([0, 0.12, 0], [0.6, 0.04, 0.5], METAL),
    // vertical corner posts
    box([-0.27, 0.45, -0.22], [0.02, 0.66, 0.02], METAL),
    box([0.27, 0.45, -0.22], [0.02, 0.66, 0.02], METAL),
    box([-0.27, 0.45, 0.22], [0.02, 0.66, 0.02], METAL),
    box([0.27, 0.45, 0.22], [0.02, 0.66, 0.02], METAL),
    // wire grid sides (horizontal bars)
    box([0, 0.25, -0.22], [0.56, 0.01, 0.01], DARK),
    box([0, 0.4, -0.22], [0.56, 0.01, 0.01], DARK),
    box([0, 0.55, -0.22], [0.56, 0.01, 0.01], DARK),
    box([0, 0.25, 0.22], [0.56, 0.01, 0.01], DARK),
    box([0, 0.4, 0.22], [0.56, 0.01, 0.01], DARK),
    box([0, 0.55, 0.22], [0.56, 0.01, 0.01], DARK),
    // wire grid sides (vertical bars)
    box([-0.2, 0.45, -0.22], [0.01, 0.4, 0.01], DARK),
    box([0, 0.45, -0.22], [0.01, 0.4, 0.01], DARK),
    box([0.2, 0.45, -0.22], [0.01, 0.4, 0.01], DARK),
    box([-0.2, 0.45, 0.22], [0.01, 0.4, 0.01], DARK),
    box([0, 0.45, 0.22], [0.01, 0.4, 0.01], DARK),
    box([0.2, 0.45, 0.22], [0.01, 0.4, 0.01], DARK),
    // back gate grid
    box([-0.27, 0.25, 0], [0.01, 0.01, 0.46], DARK),
    box([-0.27, 0.4, 0], [0.01, 0.01, 0.46], DARK),
    box([-0.27, 0.55, 0], [0.01, 0.01, 0.46], DARK),
    // handle bar
    box([-0.27, 0.78, -0.22], [0.02, 0.02, 0.5], PLASTIC),
    box([0.27, 0.78, -0.22], [0.02, 0.02, 0.5], PLASTIC),
    box([0, 0.78, 0.28], [0.58, 0.02, 0.02], PLASTIC),
    // wheels
    cylinder8([-0.22, 0.06, -0.18], 0.06, 0.03, WHEEL, [90, 0, 0]),
    cylinder8([0.22, 0.06, -0.18], 0.06, 0.03, WHEEL, [90, 0, 0]),
    cylinder8([-0.22, 0.06, 0.18], 0.06, 0.03, WHEEL, [90, 0, 0]),
    cylinder8([0.22, 0.06, 0.18], 0.06, 0.03, WHEEL, [90, 0, 0]),
  ];
}
