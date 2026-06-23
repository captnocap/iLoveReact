import { box, cylinder8, hx, type PropPartSpec } from '../../game/kinds/propModels';
import { type PropKindDefinition } from '../../game/kinds/props';

export const condimentStationDef: PropKindDefinition = {
  kind: 'condimentStation',
  label: 'Condiment Station',
  solid: true,
  footprintRadiusMeters: 0.35,
  footprintDepthMeters: 0.45,
  heightMeters: 0.55,
  tileKind: 'wall',
  trafficControl: 'none',
  coverClass: 'soft',
};

export function condimentStationParts(): PropPartSpec[] {
  const body = hx('#d6d9dc');
  const top = hx('#aab0b6');
  const metal = hx('#9aa1ab');
  return [
    box([0, 0.27, 0], [0.7, 0.5, 0.5], body),
    box([0, 0.54, 0], [0.72, 0.04, 0.52], top),
    cylinder8([-0.18, 0.62, -0.12], 0.05, 0.14, hx('#d4a83a')),
    cylinder8([0, 0.62, -0.12], 0.05, 0.14, hx('#b3221c')),
    cylinder8([0.18, 0.62, -0.12], 0.05, 0.14, hx('#eef0f2')),
    // mustard label
    box([-0.18, 0.62, -0.18], [0.05, 0.08, 0.01], hx('#22262b')),
    // ketchup label
    box([0, 0.62, -0.18], [0.05, 0.08, 0.01], hx('#22262b')),
    // napkin dispenser
    box([0.15, 0.58, 0.15], [0.18, 0.04, 0.12], metal),
    box([0.15, 0.62, 0.15], [0.16, 0.08, 0.02], hx('#eef0f2')),
    // napkin pull
    box([0.15, 0.58, 0.21], [0.08, 0.02, 0.03], hx('#eef0f2')),
  ];
}
