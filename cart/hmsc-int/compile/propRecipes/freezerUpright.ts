import { box, hx, panel, type PropPartSpec } from '../../game/kinds/propModels';
import { type PropKindDefinition } from '../../game/kinds/props';

export const freezerUprightDef: PropKindDefinition = {
  kind: 'freezerUpright',
  label: 'Upright Freezer',
  solid: true,
  footprintRadiusMeters: 0.4,
  heightMeters: 1.7,
  tileKind: 'wall',
  trafficControl: 'none',
  container: { lootCategory: 'food', capacity: 5, spawnFillChance: 0.6, searchSeconds: 3, access: 'open' },
};

const WHITE = hx('#eef0f2');
const GREY = hx('#c2c6cc');
const DARK = hx('#3a3f46');
const HANDLE = hx('#6c727b');

export function freezerUprightParts(): PropPartSpec[] {
  return [
    // cabinet body
    box([0, 0.85, 0], [0.72, 1.7, 0.64], WHITE),
    // door (slightly proud)
    box([0, 0.85, 0.05], [0.66, 1.6, 0.06], GREY),
    // vertical handle
    box([0.22, 0.95, 0.1], [0.03, 0.7, 0.03], HANDLE),
    // handle mounts
    box([0.22, 1.28, 0.1], [0.05, 0.05, 0.05], HANDLE),
    box([0.22, 0.62, 0.1], [0.05, 0.05, 0.05], HANDLE),
    // brand panel (image target)
    panel('logo', [0, 1.45, 0.1], [0.4, 0.12, 0.01], WHITE),
    // bottom vent
    box([0, 0.12, 0.3], [0.5, 0.16, 0.04], DARK),
    // temperature display
    box([0.22, 1.35, 0.1], [0.06, 0.04, 0.01], DARK),
    // feet
    box([-0.3, 0.03, -0.25], [0.06, 0.04, 0.06], DARK),
    box([0.3, 0.03, -0.25], [0.06, 0.04, 0.06], DARK),
    box([-0.3, 0.03, 0.25], [0.06, 0.04, 0.06], DARK),
    box([0.3, 0.03, 0.25], [0.06, 0.04, 0.06], DARK),
  ];
}
