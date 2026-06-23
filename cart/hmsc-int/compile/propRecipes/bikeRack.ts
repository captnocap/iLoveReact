import { box, hx, type PropPartSpec } from '../../game/kinds/propModels';
import { type PropKindDefinition } from '../../game/kinds/props';

export const bikeRackDef: PropKindDefinition = {
  kind: 'bikeRack',
  label: 'Bike Rack',
  solid: true,
  footprintRadiusMeters: 0.85,
  footprintDepthMeters: 0.35,
  heightMeters: 0.75,
  tileKind: 'wall',
  trafficControl: 'none',
  coverClass: 'none',
};

export function bikeRackParts(): PropPartSpec[] {
  const steel = hx('#6c727b');
  const bright = hx('#9aa1ab');
  const w = 1.7;
  const parts: PropPartSpec[] = [
    box([0, 0.04, 0], [w, 0.06, 0.25], steel),
    box([0, 0.7, 0], [w, 0.04, 0.2], steel),
    box([0, 0.38, 0], [w, 0.03, 0.18], bright),
  ];
  const postCount = 5;
  for (let i = 0; i < postCount; i++) {
    const x = -w * 0.4 + i * (w * 0.2);
    parts.push(box([x, 0.37, 0], [0.04, 0.7, 0.04], bright));
    parts.push(box([x, 0.72, 0], [0.08, 0.04, 0.25], bright));
    // ground plate
    parts.push(box([x, 0.02, 0], [0.1, 0.02, 0.3], steel));
  }
  return parts;
}
