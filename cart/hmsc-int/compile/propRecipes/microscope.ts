import { box, cylinder8, hx, type PropPartSpec } from '../../game/kinds/propModels';
import { type PropKindDefinition } from '../../game/kinds/props';

export const microscopeDef: PropKindDefinition = {
  kind: 'microscope',
  label: 'Microscope',
  solid: true,
  footprintRadiusMeters: 0.08,
  heightMeters: 0.18,
  tileKind: 'wall',
  trafficControl: 'none',
};

const BODY = hx('#4a4a4e');
const METAL = hx('#9aa1ab');
const BLACK = hx('#1a1c1e');
const GLASS = hx('#2c4a66');

export function microscopeParts(): PropPartSpec[] {
  return [
    // heavy base
    box([0, 0.02, 0], [0.14, 0.03, 0.12], BODY),
    // vertical arm
    box([-0.04, 0.08, -0.04], [0.04, 0.1, 0.04], BODY),
    // stage
    box([0.02, 0.06, 0], [0.1, 0.01, 0.1], METAL),
    // slide on stage
    box([0.02, 0.07, 0], [0.05, 0.005, 0.02], GLASS),
    // objective lens turret
    cylinder8([0.02, 0.09, 0], 0.02, 0.03, METAL),
    box([0.02, 0.08, 0], [0.02, 0.03, 0.02], BLACK),
    // eyepiece tube (angled)
    box([0.02, 0.13, -0.02], [0.03, 0.08, 0.03], BODY, [0, 0, -30]),
    // eyepiece
    cylinder8([0.02, 0.16, -0.05], 0.015, 0.04, BLACK, [0, 0, -30]),
    // focus knobs
    cylinder8([-0.02, 0.08, 0], 0.015, 0.03, BLACK, [0, 90, 0]),
  ];
}
