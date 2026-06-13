import { box, hx, METAL, NEAR_BLACK, panel, type PropPartSpec } from '../../game/kinds/propModels';
import { propKindDefinition } from '../../game/kinds/props';

import { type PropKindDefinition } from '../../game/kinds/props';

export const vendingMachineDef: PropKindDefinition = {
  kind: 'vendingMachine',
  label: 'Vending Machine',
  // Real ~1.83m × 1.15. The front panel is an image target (partId 'front').
  solid: true,
  footprintRadiusMeters: 0.5,
  heightMeters: 2.1,
  tileKind: 'wall',
  trafficControl: 'none',
  container: { lootCategory: 'kitchen', capacity: 3, spawnFillChance: 0.5, searchSeconds: 3, access: 'locked' },
  coverClass: 'hard',
};

export function vendingMachineParts(): PropPartSpec[] {
  const s = propKindDefinition('vendingMachine').heightMeters / 2.1;
  const red = hx('#c1272d');
  const redDark = hx('#8e1d22');
  return [
    box([0, 1.02 * s, 0.02 * s], [0.94 * s, 2.0 * s, 0.78 * s], red),
    box([-0.32 * s, 0.06 * s, -0.3 * s], [0.12 * s, 0.12 * s, 0.12 * s], NEAR_BLACK),
    box([0.32 * s, 0.06 * s, -0.3 * s], [0.12 * s, 0.12 * s, 0.12 * s], NEAR_BLACK),
    // the brandable front — image target (req_0635)
    panel('front', [0, 1.12 * s, -0.38 * s], [0.86 * s, 1.7 * s, 0.03 * s], redDark),
    // display window + coin column + dispense slot ride proud of the panel
    box([-0.16 * s, 1.35 * s, -0.4 * s], [0.46 * s, 1.1 * s, 0.02 * s], hx('#15314e')),
    box([0.28 * s, 1.5 * s, -0.4 * s], [0.16 * s, 0.4 * s, 0.02 * s], METAL),
    box([0, 0.42 * s, -0.4 * s], [0.6 * s, 0.24 * s, 0.03 * s], NEAR_BLACK),
  ];
}
