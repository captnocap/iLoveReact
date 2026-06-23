import { box, cylinder16, hx, panel, type PropPartSpec } from '../../game/kinds/propModels';
import { type PropKindDefinition } from '../../game/kinds/props';

export const trashCanRecyclingDef: PropKindDefinition = {
  kind: 'trashCanRecycling',
  label: 'Recycling Bin',
  solid: true,
  footprintRadiusMeters: 0.25,
  heightMeters: 0.75,
  tileKind: 'wall',
  trafficControl: 'none',
};

const BLUE = hx('#2d5a7d');
const BLUE_DARK = hx('#1c3d57');
const LID = hx('#1a1c1e');
const WHEEL = hx('#111215');
const LABEL = hx('#d8e6f0');

export function trashCanRecyclingParts(): PropPartSpec[] {
  return [
    // main cylindrical can
    cylinder16([0, 0.36, 0], 0.25, 0.66, BLUE),
    // darker recessed base ring
    cylinder16([0, 0.04, 0], 0.23, 0.08, BLUE_DARK),
    // molded rim
    cylinder16([0, 0.68, 0], 0.27, 0.05, BLUE_DARK),
    // domed lid with slot
    cylinder16([0, 0.74, 0], 0.24, 0.06, LID),
    box([0, 0.76, 0], [0.18, 0.02, 0.12], LID),
    // recycling label panel (image target)
    panel('label', [0, 0.42, 0.23], [0.22, 0.22, 0.01], LABEL),
    // two small wheels at the back
    cylinder16([-0.15, 0.04, -0.15], 0.035, 0.03, WHEEL, [90, 0, 0]),
    cylinder16([0.15, 0.04, -0.15], 0.035, 0.03, WHEEL, [90, 0, 0]),
  ];
}
