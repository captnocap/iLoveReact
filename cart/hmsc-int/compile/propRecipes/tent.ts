import { box, cylinder8, hx, type PropPartSpec } from '../../game/kinds/propModels';
import { type PropKindDefinition } from '../../game/kinds/props';

export const tentDef: PropKindDefinition = {
  kind: 'tent',
  label: 'Tent',
  solid: true,
  footprintRadiusMeters: 1.2,
  heightMeters: 1.4,
  tileKind: 'wall',
  trafficControl: 'none',
  coverClass: 'soft',
};

const FABRIC = hx('#3a7d80');
const FABRIC_DARK = hx('#2a5c5e');
const POLE = hx('#9aa1ab');

export function tentParts(): PropPartSpec[] {
  return [
    // floor
    box([0, 0.02, 0], [2.2, 0.04, 1.9], FABRIC_DARK),
    // left sloped wall
    box([0, 0.7, -0.85], [2.2, 1.35, 0.08], FABRIC, [30, 0, 0]),
    // right sloped wall
    box([0, 0.7, 0.85], [2.2, 1.35, 0.08], FABRIC, [-30, 0, 0]),
    // roof ridge line / support
    box([0, 1.36, 0], [2.2, 0.06, 0.06], FABRIC_DARK),
    // front triangular wall (left half)
    box([-0.55, 0.7, 0.92], [1.0, 1.25, 0.04], FABRIC, [0, 0, -38]),
    // front triangular wall (right half)
    box([0.55, 0.7, 0.92], [1.0, 1.25, 0.04], FABRIC, [0, 0, 38]),
    // door flap (open, darker)
    box([0, 0.55, 0.96], [0.45, 0.9, 0.02], FABRIC_DARK),
    // back wall
    box([0, 0.7, -0.92], [2.2, 1.25, 0.04], FABRIC),
    // support poles at corners
    cylinder8([-0.9, 0.7, -0.7], 0.02, 1.4, POLE, [0, 0, 15]),
    cylinder8([0.9, 0.7, -0.7], 0.02, 1.4, POLE, [0, 0, -15]),
    cylinder8([-0.9, 0.7, 0.7], 0.02, 1.4, POLE, [0, 0, 15]),
    cylinder8([0.9, 0.7, 0.7], 0.02, 1.4, POLE, [0, 0, -15]),
    // stakes / guy lines (small boxes at base)
    box([-1.1, 0.02, -0.9], [0.05, 0.02, 0.05], POLE),
    box([1.1, 0.02, -0.9], [0.05, 0.02, 0.05], POLE),
  ];
}
