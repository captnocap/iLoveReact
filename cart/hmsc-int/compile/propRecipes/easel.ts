import { box, hx, panel, type PropPartSpec } from '../../game/kinds/propModels';
import { type PropKindDefinition } from '../../game/kinds/props';

export const easelDef: PropKindDefinition = {
  kind: 'easel',
  label: 'Easel',
  solid: true,
  footprintRadiusMeters: 0.25,
  heightMeters: 1.3,
  tileKind: 'wall',
  trafficControl: 'none',
};

const WOOD = hx('#6b4a2e');
const CANVAS = hx('#eef0f2');

export function easelParts(): PropPartSpec[] {
  return [
    // front left leg
    box([-0.12, 0.55, 0.12], [0.04, 1.1, 0.04], WOOD, [0, 0, -10]),
    // front right leg
    box([0.12, 0.55, 0.12], [0.04, 1.1, 0.04], WOOD, [0, 0, 10]),
    // back leg
    box([0, 0.55, -0.15], [0.04, 1.1, 0.04], WOOD, [12, 0, 0]),
    // horizontal shelf
    box([0, 0.45, 0.12], [0.35, 0.03, 0.04], WOOD),
    // canvas (image target)
    panel('canvas', [0, 0.78, 0.14], [0.35, 0.55, 0.01], CANVAS, [0, 0, -5]),
    // top holder clamp
    box([0, 1.08, 0.14], [0.3, 0.03, 0.03], WOOD),
  ];
}
