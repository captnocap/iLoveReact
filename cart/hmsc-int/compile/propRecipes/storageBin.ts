import { box, hx, type PropPartSpec } from '../../game/kinds/propModels';
import { type PropKindDefinition } from '../../game/kinds/props';

export const storageBinDef: PropKindDefinition = {
  kind: 'storageBin',
  label: 'Storage Bin',
  solid: true,
  footprintRadiusMeters: 0.35,
  heightMeters: 0.42,
  tileKind: 'wall',
  trafficControl: 'none',
  container: { lootCategory: 'junk', capacity: 3, spawnFillChance: 0.5, searchSeconds: 2, access: 'open' },
  coverClass: 'soft',
};

export function storageBinParts(): PropPartSpec[] {
  return [
    box([0, 0.21, 0], [0.7, 0.38, 0.55], hx('#3a7d80')),
    box([0, 0.42, 0], [0.74, 0.04, 0.59], hx('#2d6a4f')),
    box([-0.3, 0.3, 0], [0.04, 0.08, 0.1], hx('#9aa1ab')), // handle
    box([0.3, 0.3, 0], [0.04, 0.08, 0.1], hx('#9aa1ab')),
  ];
}
