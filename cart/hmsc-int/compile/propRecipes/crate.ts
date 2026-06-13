import { box, WOOD, WOOD_DARK, WOOD_PALE, type PropPartSpec } from '../../game/kinds/propModels';
import { propKindDefinition } from '../../game/kinds/props';

import { type PropKindDefinition } from '../../game/kinds/props';

export const crateDef: PropKindDefinition = {
  kind: 'crate',
  label: 'Wooden Crate',
  solid: true,
  footprintRadiusMeters: 0.35,
  heightMeters: 0.65,
  tileKind: 'wall',
  trafficControl: 'none',
  container: { lootCategory: 'tools', capacity: 3, spawnFillChance: 0.55, searchSeconds: 2.5, access: 'open' },
};

export function crateParts(): PropPartSpec[] {
  const s = propKindDefinition('crate').heightMeters / 0.65;
  return [
    box([0, 0.31 * s, 0], [0.62 * s, 0.58 * s, 0.62 * s], WOOD),
    box([0, 0.12 * s, 0], [0.65 * s, 0.1 * s, 0.65 * s], WOOD_DARK),
    box([0, 0.5 * s, 0], [0.65 * s, 0.1 * s, 0.65 * s], WOOD_DARK),
    box([0, 0.61 * s, 0], [0.64 * s, 0.04 * s, 0.2 * s], WOOD_PALE),
    box([0, 0.61 * s, 0], [0.2 * s, 0.04 * s, 0.64 * s], WOOD_PALE),
  ];
}
