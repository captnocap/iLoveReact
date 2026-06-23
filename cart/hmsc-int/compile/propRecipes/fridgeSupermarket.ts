import { box, hx, panel, type PropPartSpec } from '../../game/kinds/propModels';
import { type PropKindDefinition } from '../../game/kinds/props';

export const fridgeSupermarketDef: PropKindDefinition = {
  kind: 'fridgeSupermarket',
  label: 'Supermarket Fridge',
  solid: true,
  footprintRadiusMeters: 0.5,
  heightMeters: 2.0,
  tileKind: 'wall',
  trafficControl: 'none',
  container: { lootCategory: 'food', capacity: 6, spawnFillChance: 0.7, searchSeconds: 3, access: 'open' },
};

const WHITE = hx('#eef0f2');
const SILVER = hx('#9aa1ab');
const GLASS = hx('#2c4a66');
const DARK = hx('#3a3f46');

export function fridgeSupermarketParts(): PropPartSpec[] {
  return [
    // tall cabinet shell
    box([0, 1.0, 0], [0.9, 2.0, 0.8], WHITE),
    // top compressor/light housing
    box([0, 1.92, 0], [0.88, 0.12, 0.78], DARK),
    // glass doors (two panels)
    panel('doorLeft', [-0.22, 1.05, 0.38], [0.42, 1.55, 0.02], GLASS),
    panel('doorRight', [0.22, 1.05, 0.38], [0.42, 1.55, 0.02], GLASS),
    // door frames
    box([-0.22, 1.05, 0.39], [0.44, 1.59, 0.03], SILVER),
    box([0.22, 1.05, 0.39], [0.44, 1.59, 0.03], SILVER),
    // vertical handles
    box([-0.02, 1.05, 0.42], [0.02, 1.4, 0.03], SILVER),
    box([0.02, 1.05, 0.42], [0.02, 1.4, 0.03], SILVER),
    // horizontal shelves inside
    box([0, 0.55, 0.1], [0.8, 0.01, 0.5], SILVER),
    box([0, 0.95, 0.1], [0.8, 0.01, 0.5], SILVER),
    box([0, 1.35, 0.1], [0.8, 0.01, 0.5], SILVER),
    box([0, 1.75, 0.1], [0.8, 0.01, 0.5], SILVER),
    // drinks / products
    box([-0.25, 0.65, 0.15], [0.08, 0.18, 0.08], hx('#c2362f')),
    box([-0.1, 0.65, 0.15], [0.08, 0.18, 0.08], hx('#3a7d80')),
    box([0.05, 0.65, 0.15], [0.08, 0.18, 0.08], hx('#e8b84a')),
    box([0.2, 0.65, 0.15], [0.08, 0.18, 0.08], hx('#3f7d33')),
    box([-0.25, 1.05, 0.15], [0.08, 0.18, 0.08], hx('#2c4a66')),
    box([-0.1, 1.05, 0.15], [0.08, 0.18, 0.08], hx('#8a4a32')),
    box([0.05, 1.05, 0.15], [0.08, 0.18, 0.08], hx('#c2362f')),
    box([0.2, 1.05, 0.15], [0.08, 0.18, 0.08], hx('#3a7d80')),
    // bottom grille
    box([0, 0.12, 0.3], [0.7, 0.16, 0.04], DARK),
  ];
}
