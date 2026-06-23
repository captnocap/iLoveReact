import { type PropKindDefinition } from '../../game/kinds/props';
import { box, hx, NEAR_BLACK, STEEL, WHITE, type PropPartSpec } from '../../game/kinds/propModels';
import { propKindDefinition } from '../../game/kinds/props';

export function orderCounterParts(): PropPartSpec[] {
  const def = propKindDefinition('orderCounter');
  const w = def.footprintRadiusMeters * 2;
  const face = hx('#c14d4d');
  return [
    box([0, 0.5, 0], [w, 1.0, 0.7], face),
    box([0, 1.03, 0], [w + 0.06, 0.06, 0.78], WHITE),
    box([0, 0.5, -0.36], [w - 0.2, 0.5, 0.02], hx('#a83a3a')),
    box([w * 0.22, 1.18, 0.05], [0.3, 0.24, 0.3], NEAR_BLACK),
    box([-w * 0.2, 1.09, 0], [0.34, 0.05, 0.3], STEEL),
  ];
}

export const orderCounterDef: PropKindDefinition = {
  kind: 'orderCounter',
  label: 'Order Counter',
  solid: true,
  footprintRadiusMeters: 0.9,
  heightMeters: 1.16,
  tileKind: 'wall',
  trafficControl: 'none',
  container: { lootCategory: 'valuables', capacity: 2, spawnFillChance: 0.5, searchSeconds: 3, access: 'locked' },
};
