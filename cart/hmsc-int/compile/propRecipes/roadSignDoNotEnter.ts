import { box, cylinder16, hx, panel, type PropPartSpec } from '../../game/kinds/propModels';
import { type PropKindDefinition } from '../../game/kinds/props';

export const roadSignDoNotEnterDef: PropKindDefinition = {
  kind: 'roadSignDoNotEnter',
  label: 'Do Not Enter Sign',
  solid: true,
  footprintRadiusMeters: 0.25,
  heightMeters: 1.8,
  tileKind: 'wall',
  trafficControl: 'none',
};

const POST = hx('#74201c');
const RED = hx('#c2362f');
const WHITE = hx('#eef0f2');

export function roadSignDoNotEnterParts(): PropPartSpec[] {
  return [
    // post
    box([0, 0.8, 0], [0.06, 1.6, 0.06], POST),
    // red circular back
    cylinder16([0, 1.7, 0], 0.3, 0.05, RED, [90, 0, 0]),
    // white horizontal bar (no-entry symbol)
    box([0, 1.7, 0.03], [0.36, 0.08, 0.02], WHITE),
    // smaller white inner circle
    cylinder16([0, 1.7, 0.02], 0.18, 0.04, WHITE, [90, 0, 0]),
    // front label/image target
    panel('sign', [0, 1.7, 0.04], [0.4, 0.4, 0.01], RED),
  ];
}
