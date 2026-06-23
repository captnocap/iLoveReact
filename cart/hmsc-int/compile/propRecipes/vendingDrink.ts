import { box, hx, panel, type PropPartSpec } from '../../game/kinds/propModels';
import { type PropKindDefinition } from '../../game/kinds/props';

export const vendingDrinkDef: PropKindDefinition = {
  kind: 'vendingDrink',
  label: 'Drink Vending Machine',
  solid: true,
  footprintRadiusMeters: 0.35,
  heightMeters: 1.8,
  tileKind: 'wall',
  trafficControl: 'none',
  container: { lootCategory: 'food', capacity: 4, spawnFillChance: 0.7, searchSeconds: 2, access: 'open' },
};

const RED = hx('#c2362f');
const RED_DARK = hx('#8f2424');
const BLACK = hx('#1a1c1e');
const GLASS = hx('#2c4a66');
const SILVER = hx('#9aa1ab');

export function vendingDrinkParts(): PropPartSpec[] {
  return [
    // cabinet shell
    box([0, 0.9, 0], [0.63, 1.8, 0.56], RED),
    // top brand panel
    box([0, 1.68, 0.26], [0.58, 0.18, 0.03], BLACK),
    // glass front panel (image target)
    panel('front', [0, 1.12, 0.27], [0.5, 0.92, 0.02], GLASS),
    // glass frame
    box([0, 1.12, 0.28], [0.54, 0.96, 0.02], RED_DARK),
    // control panel on the right
    box([0.22, 0.52, 0.28], [0.12, 0.28, 0.02], SILVER),
    // buttons
    box([0.22, 0.6, 0.29], [0.02, 0.02, 0.01], hx('#3a7d80')),
    box([0.22, 0.55, 0.29], [0.02, 0.02, 0.01], hx('#e8b84a')),
    box([0.22, 0.5, 0.29], [0.02, 0.02, 0.01], hx('#8a4a32')),
    // coin slot
    box([0.22, 0.4, 0.29], [0.04, 0.01, 0.01], BLACK),
    // dispenser tray
    box([0, 0.16, 0.28], [0.4, 0.08, 0.08], BLACK),
    // drinks visible behind glass (rows)
    box([-0.12, 1.35, 0.15], [0.07, 0.12, 0.07], hx('#3a7d80')),
    box([0.0, 1.35, 0.15], [0.07, 0.12, 0.07], hx('#c2362f')),
    box([0.12, 1.35, 0.15], [0.07, 0.12, 0.07], hx('#e8b84a')),
    box([-0.12, 1.15, 0.15], [0.07, 0.12, 0.07], hx('#8a4a32')),
    box([0.0, 1.15, 0.15], [0.07, 0.12, 0.07], hx('#3f7d33')),
    box([0.12, 1.15, 0.15], [0.07, 0.12, 0.07], hx('#2c4a66')),
    // feet
    box([-0.25, 0.03, -0.22], [0.06, 0.04, 0.06], BLACK),
    box([0.25, 0.03, -0.22], [0.06, 0.04, 0.06], BLACK),
    box([-0.25, 0.03, 0.22], [0.06, 0.04, 0.06], BLACK),
    box([0.25, 0.03, 0.22], [0.06, 0.04, 0.06], BLACK),
  ];
}
