import { box, cylinder8, hx, type PropPartSpec } from '../../game/kinds/propModels';
import { type PropKindDefinition } from '../../game/kinds/props';

export const securityCameraDef: PropKindDefinition = {
  kind: 'securityCamera',
  label: 'Security Camera',
  solid: true,
  footprintRadiusMeters: 0.15,
  footprintDepthMeters: 0.28,
  heightMeters: 0.25,
  tileKind: 'wall',
  trafficControl: 'none',
  mount: 'wall',
  coverClass: 'none',
};

export function securityCameraParts(): PropPartSpec[] {
  const housing = hx('#22262b');
  const lens = hx('#2c4a66');
  const core = hx('#1a1c1e');
  const metal = hx('#6c727b');
  return [
    // wall mounting plate
    box([0, 0.18, 0], [0.12, 0.12, 0.04], housing),
    // articulated arm
    box([0, 0.14, 0.08], [0.06, 0.06, 0.16], metal),
    box([0, 0.12, 0.16], [0.04, 0.04, 0.06], housing),
    // camera housing
    box([0, 0.12, 0.24], [0.16, 0.16, 0.28], housing),
    // lens cylinder
    cylinder8([0, 0.12, 0.38], 0.06, 0.12, lens),
    // lens core
    box([0, 0.12, 0.4], [0.08, 0.08, 0.04], core),
    // cable droop
    cylinder8([0.05, 0.16, 0.05], 0.01, 0.14, metal, [30, 0, 0]),
  ];
}
