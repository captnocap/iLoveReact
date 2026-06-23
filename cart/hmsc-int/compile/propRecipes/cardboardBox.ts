import { box, hx, type PropPartSpec } from '../../game/kinds/propModels';
import { type PropKindDefinition } from '../../game/kinds/props';

export const cardboardBoxDef: PropKindDefinition = {
  kind: 'cardboardBox',
  label: 'Cardboard Box',
  solid: true,
  footprintRadiusMeters: 0.35,
  heightMeters: 0.45,
  tileKind: 'wall',
  trafficControl: 'none',
  container: { lootCategory: 'junk', capacity: 3, spawnFillChance: 0.5, searchSeconds: 2, access: 'open' },
  coverClass: 'soft',
};

export function cardboardBoxParts(): PropPartSpec[] {
  return [
    box([0, 0.22, 0], [0.7, 0.4, 0.7], hx('#c2a878')),
    box([0, 0.42, 0], [0.72, 0.04, 0.72], hx('#b09a6a')),
    box([0, 0.22, -0.36], [0.6, 0.2, 0.02], hx('#a89060')), // tape seam
  ];
}
