import { box, glassBox, hx, panel, type PropPartSpec } from '../../game/kinds/propModels';
import { type PropKindDefinition } from '../../game/kinds/props';

export const coolerDrinkDef: PropKindDefinition = {
  kind: 'coolerDrink',
  label: 'Drink Cooler',
  solid: true,
  footprintRadiusMeters: 0.4,
  heightMeters: 1.4,
  tileKind: 'wall',
  trafficControl: 'none',
  container: { lootCategory: 'food', capacity: 4, spawnFillChance: 0.6, searchSeconds: 2, access: 'open' },
};

const WHITE = hx('#eef0f2');
const GREY = hx('#c2c6cc');
const DARK = hx('#2c3036');
const HANDLE = hx('#6c727b');

export function coolerDrinkParts(): PropPartSpec[] {
  return [
    // main cabinet shell
    box([0, 0.7, 0], [0.72, 1.4, 0.64], WHITE),
    // top canopy / light
    box([0, 1.38, 0.04], [0.74, 0.06, 0.5], DARK),
    // bottom vent grille
    box([0, 0.12, 0.26], [0.6, 0.16, 0.02], GREY),
    // glass door (slightly recessed)
    panel('door', [0, 0.76, 0.3], [0.58, 1.04, 0.02], DARK),
    // door frame
    box([0, 0.76, 0.31], [0.6, 1.06, 0.02], WHITE),
    // vertical handle
    box([0.24, 0.82, 0.34], [0.03, 0.55, 0.03], HANDLE),
    // drinks visible inside (rows of colored cans)
    box([-0.12, 0.55, 0.1], [0.08, 0.12, 0.08], hx('#c2362f')),
    box([0.0, 0.55, 0.1], [0.08, 0.12, 0.08], hx('#3a7d80')),
    box([0.12, 0.55, 0.1], [0.08, 0.12, 0.08], hx('#e8b84a')),
    box([-0.12, 0.78, 0.1], [0.08, 0.12, 0.08], hx('#3f7d33')),
    box([0.0, 0.78, 0.1], [0.08, 0.12, 0.08], hx('#8a4a32')),
    box([0.12, 0.78, 0.1], [0.08, 0.12, 0.08], hx('#2c4a66')),
    // feet
    box([-0.3, 0.03, -0.25], [0.06, 0.04, 0.06], DARK),
    box([0.3, 0.03, -0.25], [0.06, 0.04, 0.06], DARK),
    box([-0.3, 0.03, 0.25], [0.06, 0.04, 0.06], DARK),
    box([0.3, 0.03, 0.25], [0.06, 0.04, 0.06], DARK),
  ];
}
