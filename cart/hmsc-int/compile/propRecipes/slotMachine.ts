import { type PropKindDefinition } from '../../game/kinds/props';
import { box, cylinder8, hx, NEAR_BLACK, sphere, STEEL, WHITE, type PropPartSpec } from '../../game/kinds/propModels';
import { propKindDefinition } from '../../game/kinds/props';

export function slotMachineParts(): PropPartSpec[] {
  const s = propKindDefinition('slotMachine').heightMeters / 1.45;
  const body = hx('#c1272d');
  const gold = hx('#d8b23a');
  return [
    box([0, 0.25 * s, 0], [0.4 * s, 0.5 * s, 0.4 * s], NEAR_BLACK),
    box([0, 0.85 * s, 0], [0.55 * s, 0.7 * s, 0.5 * s], body),
    box([0, 0.95 * s, -0.26 * s], [0.4 * s, 0.22 * s, 0.02 * s], WHITE),
    box([-0.12 * s, 0.95 * s, -0.275 * s], [0.08 * s, 0.14 * s, 0.01 * s], hx('#c14d4d')),
    box([0, 0.95 * s, -0.275 * s], [0.08 * s, 0.14 * s, 0.01 * s], gold),
    box([0.12 * s, 0.95 * s, -0.275 * s], [0.08 * s, 0.14 * s, 0.01 * s], hx('#2e6f55')),
    box([0, 0.62 * s, -0.26 * s], [0.3 * s, 0.1 * s, 0.02 * s], NEAR_BLACK),
    cylinder8([0.32 * s, 1.0 * s, 0], 0.02 * s, 0.3 * s, STEEL),
    sphere([0.32 * s, 1.17 * s, 0], [0.08 * s, 0.08 * s, 0.08 * s], body),
    cylinder8([0, 1.32 * s, 0], 0.07 * s, 0.24 * s, gold),
  ];
}

export const slotMachineDef: PropKindDefinition = {
  kind: 'slotMachine',
  label: 'Slot Machine',
  solid: true,
  footprintRadiusMeters: 0.3,
  heightMeters: 1.45,
  tileKind: 'wall',
  trafficControl: 'none',
  container: { lootCategory: 'valuables', capacity: 2, spawnFillChance: 0.4, searchSeconds: 3, access: 'locked' },
};
