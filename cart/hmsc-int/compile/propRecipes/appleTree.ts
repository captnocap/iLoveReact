import { cylinder8, hx, sphere, type PropPartSpec } from '../../game/kinds/propModels';
import { propKindDefinition } from '../../game/kinds/props';

import { type PropKindDefinition } from '../../game/kinds/props';

export const appleTreeDef: PropKindDefinition = {
  kind: 'appleTree',
  label: 'Apple Tree',
  // Orchard scale (~5.5m × 1.15), apples visible in the canopy. The DROP —
  // apples detaching as live bodies over time — is a future spawn slice;
  // today you place 'apple' props under it and they roll/kick like balls
  // (and become throwable/eatable when the item system lands, user ask).
  solid: true,
  footprintRadiusMeters: 0.35,
  heightMeters: 6.5,
  tileKind: 'wall',
  trafficControl: 'none',
};

export function appleTreeParts(): PropPartSpec[] {
  const def = propKindDefinition('appleTree');
  const h = def.heightMeters;
  const r = def.footprintRadiusMeters;
  const c = h * 0.3;
  const bark = hx('#5c4631');
  const leafMid = hx('#2f6b2f');
  const leafLight = hx('#43883a');
  const appleRed = hx('#c1272d');
  const parts: PropPartSpec[] = [
    cylinder8([0, h * 0.26, 0], r, h * 0.52, bark),
    sphere([0, h * 0.68, 0], [c * 2.1, c * 1.7, c * 2.1], leafMid),
    sphere([c * 0.7, h * 0.6, c * 0.3], [c * 1.3, c * 1.1, c * 1.3], leafLight),
    sphere([-c * 0.65, h * 0.62, -c * 0.3], [c * 1.2, c, c * 1.2], leafMid),
    sphere([0, h * 0.84, 0], [c * 1.2, c * 0.9, c * 1.2], leafLight),
  ];
  // apples studding the canopy edge (the kickable 'apple' prop is its own kind)
  const spots: [number, number, number][] = [
    [c * 0.9, h * 0.62, c * 0.5], [-c * 0.85, h * 0.66, c * 0.4], [c * 0.3, h * 0.56, -c * 0.9],
    [-c * 0.4, h * 0.58, -c * 0.75], [c * 0.65, h * 0.78, -c * 0.3], [-c * 0.2, h * 0.82, c * 0.7],
  ];
  for (const [x, y, z] of spots) parts.push(sphere([x, y, z], [0.13, 0.13, 0.13], appleRed));
  return parts;
}
