import { box, cylinder16, hx, sphere, type PropPartSpec } from '../../game/kinds/propModels';
import { type PropKindDefinition } from '../../game/kinds/props';

export const dressFormDef: PropKindDefinition = {
  kind: 'dressForm',
  label: 'Dress Form',
  solid: true,
  footprintRadiusMeters: 0.15,
  heightMeters: 1.3,
  tileKind: 'wall',
  trafficControl: 'none',
};

const FABRIC = hx('#8a6240');
const WOOD = hx('#6b4a2e');
const DARK = hx('#3e3226');

export function dressFormParts(): PropPartSpec[] {
  return [
    // tripod base
    box([0, 0.05, 0], [0.04, 0.04, 0.04], WOOD),
    box([-0.12, 0.12, 0], [0.28, 0.03, 0.03], WOOD, [0, 0, -15]),
    box([0.12, 0.12, 0], [0.28, 0.03, 0.03], WOOD, [0, 0, 15]),
    box([0, 0.12, 0.12], [0.03, 0.03, 0.28], WOOD, [-15, 0, 0]),
    // central pole
    cylinder16([0, 0.45, 0], 0.025, 0.9, WOOD),
    // hip / waist adjustment column
    cylinder16([0, 0.55, 0], 0.04, 0.12, DARK),
    // torso (fabric-covered)
    box([0, 0.85, 0], [0.22, 0.35, 0.14], FABRIC),
    // bust
    sphere([0, 0.98, 0], [0.2, 0.14, 0.12], FABRIC),
    // shoulders
    box([0, 1.05, 0], [0.32, 0.06, 0.12], FABRIC),
    // neck cap
    cylinder16([0, 1.12, 0], 0.04, 0.06, WOOD),
  ];
}
