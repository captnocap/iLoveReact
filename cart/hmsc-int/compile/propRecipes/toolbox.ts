import { box, hx, type PropPartSpec } from '../../game/kinds/propModels';
import { type PropKindDefinition } from '../../game/kinds/props';

export const toolboxDef: PropKindDefinition = {
  kind: 'toolbox',
  label: 'Toolbox',
  solid: true,
  footprintRadiusMeters: 0.15,
  heightMeters: 0.18,
  tileKind: 'wall',
  trafficControl: 'none',
  container: { lootCategory: 'tools', capacity: 2, spawnFillChance: 0.6, searchSeconds: 2, access: 'open' },
};

const RED = hx('#c2362f');
const DARK = hx('#8f2424');
const SILVER = hx('#9aa1ab');
const BLACK = hx('#1a1c1e');

export function toolboxParts(): PropPartSpec[] {
  return [
    // bottom tray
    box([0, 0.06, 0], [0.27, 0.1, 0.24], RED),
    // lid
    box([0, 0.14, 0], [0.27, 0.04, 0.24], DARK),
    // lid lip
    box([0, 0.12, 0], [0.28, 0.02, 0.25], DARK),
    // top handle
    box([0, 0.18, 0], [0.16, 0.02, 0.03], BLACK),
    box([0, 0.17, 0], [0.03, 0.05, 0.03], BLACK),
    // latches
    box([-0.08, 0.13, 0.13], [0.04, 0.04, 0.01], SILVER),
    box([0.08, 0.13, 0.13], [0.04, 0.04, 0.01], SILVER),
    // corner guards
    box([-0.12, 0.06, -0.1], [0.02, 0.1, 0.02], SILVER),
    box([0.12, 0.06, -0.1], [0.02, 0.1, 0.02], SILVER),
    box([-0.12, 0.06, 0.1], [0.02, 0.1, 0.02], SILVER),
    box([0.12, 0.06, 0.1], [0.02, 0.1, 0.02], SILVER),
  ];
}
