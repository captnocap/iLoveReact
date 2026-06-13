import { cylinder16, hx, type PropPartSpec } from '../../game/kinds/propModels';
import { propKindDefinition } from '../../game/kinds/props';

import { type PropKindDefinition } from '../../game/kinds/props';

export const steelDrumDef: PropKindDefinition = {
  kind: 'steelDrum',
  label: 'Steel Drum',
  // The rusty 55-gal drum — heavy but it topples and rolls when shoved.
  solid: true,
  footprintRadiusMeters: 0.32,
  heightMeters: 1.0,
  tileKind: 'wall',
  trafficControl: 'none',
  dynamics: { bodyRadiusMeters: 0.42, restitution: 0.18 },
};

export function steelDrumParts(): PropPartSpec[] {
  const h = propKindDefinition('steelDrum').heightMeters;
  const body = hx('#7a3b2a');
  return [
    cylinder16([0, h * 0.48, 0], 0.3, h * 0.94, body),
    cylinder16([0, h * 0.33, 0], 0.315, h * 0.05, hx('#5e2c1e')),
    cylinder16([0, h * 0.66, 0], 0.315, h * 0.05, hx('#5e2c1e')),
    cylinder16([0, h * 0.97, 0], 0.295, h * 0.04, hx('#4a4843')),
  ];
}
