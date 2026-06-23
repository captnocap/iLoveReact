import { box, cylinder16, hx, sphere, type PropPartSpec } from '../../game/kinds/propModels';
import { type PropKindDefinition } from '../../game/kinds/props';

export const globeDef: PropKindDefinition = {
  kind: 'globe',
  label: 'Globe',
  solid: true,
  footprintRadiusMeters: 0.1,
  heightMeters: 0.25,
  tileKind: 'wall',
  trafficControl: 'none',
};

const OCEAN = hx('#2d5a7d');
const LAND = hx('#3f7d33');
const STAND = hx('#6b4a2e');
const MERIDIAN = hx('#9aa1ab');

export function globeParts(): PropPartSpec[] {
  return [
    // wooden base
    cylinder16([0, 0.03, 0], 0.09, 0.04, STAND),
    // central pedestal
    cylinder16([0, 0.1, 0], 0.02, 0.12, STAND),
    // meridian arc (half circle approximated by rotated boxes)
    box([0, 0.2, 0], [0.02, 0.25, 0.02], MERIDIAN, [0, 0, 0]),
    box([0, 0.28, 0], [0.02, 0.02, 0.22], MERIDIAN),
    // globe sphere
    sphere([0, 0.2, 0], [0.18, 0.18, 0.18], OCEAN),
    // continents (lighter green patches)
    sphere([0.06, 0.22, 0.05], [0.08, 0.08, 0.08], LAND),
    sphere([-0.05, 0.18, -0.04], [0.07, 0.07, 0.07], LAND),
  ];
}
