import { box, hx, panel, type PropPartSpec } from '../../game/kinds/propModels';
import { type PropKindDefinition } from '../../game/kinds/props';

export const roadSignYieldDef: PropKindDefinition = {
  kind: 'roadSignYield',
  label: 'Yield Sign',
  solid: true,
  footprintRadiusMeters: 0.25,
  heightMeters: 1.9,
  tileKind: 'wall',
  trafficControl: 'none',
};

const POST = hx('#8b6e2c');
const YELLOW = hx('#e8b84a');
const DARK_YELLOW = hx('#c79a35');
const RED = hx('#c2362f');

export function roadSignYieldParts(): PropPartSpec[] {
  const signY = 1.55;
  return [
    // post
    box([0, 0.85, 0], [0.06, 1.7, 0.06], POST),
    // top horizontal bar of the triangle
    box([0, signY + 0.30, 0], [0.58, 0.06, 0.04], YELLOW),
    // left and right diagonal sides
    box([-0.23, signY, 0], [0.56, 0.06, 0.04], YELLOW, [0, 0, -60]),
    box([0.23, signY, 0], [0.56, 0.06, 0.04], YELLOW, [0, 0, 60]),
    // back plate (thinner, slightly larger)
    box([0, signY, -0.01], [0.48, 0.56, 0.02], DARK_YELLOW),
    // red yield word / triangle (image target)
    panel('sign', [0, signY, 0.03], [0.40, 0.40, 0.01], RED),
  ];
}
