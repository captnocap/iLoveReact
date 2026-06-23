import { box, hx, panel, type PropPartSpec } from '../../game/kinds/propModels';
import { type PropKindDefinition } from '../../game/kinds/props';

export const vendingSnackDef: PropKindDefinition = {
  kind: 'vendingSnack',
  label: 'Snack Vending Machine',
  solid: true,
  footprintRadiusMeters: 0.35,
  heightMeters: 1.8,
  tileKind: 'wall',
  trafficControl: 'none',
  container: { lootCategory: 'food', capacity: 4, spawnFillChance: 0.7, searchSeconds: 2, access: 'open' },
};

const BLACK = hx('#1a1c1e');
const GREY = hx('#3a3f46');
const SILVER = hx('#9aa1ab');
const GLASS = hx('#2c4a66');

export function vendingSnackParts(): PropPartSpec[] {
  return [
    // cabinet shell
    box([0, 0.9, 0], [0.63, 1.8, 0.56], BLACK),
    // top light strip
    box([0, 1.68, 0.26], [0.58, 0.12, 0.03], GREY),
    // glass front panel (image target)
    panel('front', [0, 1.05, 0.27], [0.5, 1.0, 0.02], GLASS),
    // glass frame
    box([0, 1.05, 0.28], [0.54, 1.04, 0.02], GREY),
    // horizontal shelf dividers behind glass
    box([0, 1.35, 0.15], [0.46, 0.01, 0.02], SILVER),
    box([0, 1.05, 0.15], [0.46, 0.01, 0.02], SILVER),
    box([0, 0.75, 0.15], [0.46, 0.01, 0.02], SILVER),
    // spiral coils (horizontal cylinders)
    box([-0.12, 1.5, 0.15], [0.25, 0.02, 0.02], SILVER, [0, 0, 10]),
    box([0.12, 1.5, 0.15], [0.25, 0.02, 0.02], SILVER, [0, 0, -10]),
    box([-0.12, 1.2, 0.15], [0.25, 0.02, 0.02], SILVER, [0, 0, 10]),
    box([0.12, 1.2, 0.15], [0.25, 0.02, 0.02], SILVER, [0, 0, -10]),
    box([-0.12, 0.9, 0.15], [0.25, 0.02, 0.02], SILVER, [0, 0, 10]),
    box([0.12, 0.9, 0.15], [0.25, 0.02, 0.02], SILVER, [0, 0, -10]),
    // snack boxes
    box([-0.12, 1.5, 0.05], [0.08, 0.04, 0.06], hx('#c2362f')),
    box([0.12, 1.2, 0.05], [0.08, 0.04, 0.06], hx('#e8b84a')),
    box([-0.12, 0.9, 0.05], [0.08, 0.04, 0.06], hx('#3a7d80')),
    // control panel on the right
    box([0.22, 0.45, 0.28], [0.12, 0.3, 0.02], GREY),
    // buttons
    box([0.22, 0.55, 0.29], [0.02, 0.02, 0.01], hx('#3a7d80')),
    box([0.22, 0.5, 0.29], [0.02, 0.02, 0.01], hx('#e8b84a')),
    box([0.22, 0.45, 0.29], [0.02, 0.02, 0.01], hx('#c2362f')),
    // coin slot
    box([0.22, 0.35, 0.29], [0.04, 0.01, 0.01], SILVER),
    // dispenser tray
    box([0, 0.16, 0.28], [0.4, 0.08, 0.08], BLACK),
    // feet
    box([-0.25, 0.03, -0.22], [0.06, 0.04, 0.06], GREY),
    box([0.25, 0.03, -0.22], [0.06, 0.04, 0.06], GREY),
    box([-0.25, 0.03, 0.22], [0.06, 0.04, 0.06], GREY),
    box([0.25, 0.03, 0.22], [0.06, 0.04, 0.06], GREY),
  ];
}
