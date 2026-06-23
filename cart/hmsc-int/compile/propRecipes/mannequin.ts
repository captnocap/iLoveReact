import { box, cylinder16, hx, sphere, type PropPartSpec } from '../../game/kinds/propModels';
import { type PropKindDefinition } from '../../game/kinds/props';

export const mannequinDef: PropKindDefinition = {
  kind: 'mannequin',
  label: 'Mannequin',
  solid: true,
  footprintRadiusMeters: 0.18,
  heightMeters: 1.5,
  tileKind: 'wall',
  trafficControl: 'none',
};

const SKIN = hx('#e8e8e8');
const DARK = hx('#c2c2c2');

export function mannequinParts(): PropPartSpec[] {
  return [
    // round base / stand
    cylinder16([0, 0.04, 0], 0.16, 0.08, DARK),
    // lower leg L/R
    cylinder16([-0.06, 0.25, 0], 0.04, 0.4, SKIN),
    cylinder16([0.06, 0.25, 0], 0.04, 0.4, SKIN),
    // hips
    box([0, 0.52, 0], [0.18, 0.08, 0.12], SKIN),
    // torso
    box([0, 0.78, 0], [0.2, 0.48, 0.12], SKIN),
    // shoulders
    box([0, 1.04, 0], [0.36, 0.08, 0.1], SKIN),
    // arms
    cylinder16([-0.2, 0.85, 0], 0.035, 0.42, SKIN, [0, 0, 10]),
    cylinder16([0.2, 0.85, 0], 0.035, 0.42, SKIN, [0, 0, -10]),
    // neck
    cylinder16([0, 1.06, 0], 0.04, 0.08, SKIN),
    // head
    sphere([0, 1.18, 0], [0.14, 0.16, 0.14], SKIN),
  ];
}
