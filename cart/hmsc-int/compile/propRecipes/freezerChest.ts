import { box, hx, panel, type PropPartSpec } from '../../game/kinds/propModels';
import { type PropKindDefinition } from '../../game/kinds/props';

export const freezerChestDef: PropKindDefinition = {
  kind: 'freezerChest',
  label: 'Chest Freezer',
  solid: true,
  footprintRadiusMeters: 0.45,
  heightMeters: 0.9,
  tileKind: 'wall',
  trafficControl: 'none',
  container: { lootCategory: 'food', capacity: 4, spawnFillChance: 0.6, searchSeconds: 3, access: 'open' },
};

const WHITE = hx('#eef0f2');
const GREY = hx('#c2c6cc');
const DARK = hx('#3a3f46');
const HANDLE = hx('#6c727b');

export function freezerChestParts(): PropPartSpec[] {
  return [
    // main box body
    box([0, 0.4, 0], [0.81, 0.8, 0.72], WHITE),
    // lower kick plate / vent
    box([0, 0.08, 0.3], [0.7, 0.12, 0.04], DARK),
    // top lid (slightly raised)
    box([0, 0.83, 0], [0.82, 0.06, 0.74], GREY),
    // lid seam
    box([0, 0.81, 0], [0.82, 0.02, 0.74], WHITE),
    // front handle bar
    box([0, 0.65, 0.38], [0.5, 0.03, 0.03], HANDLE),
    // handle mounts
    box([-0.22, 0.65, 0.36], [0.04, 0.06, 0.04], HANDLE),
    box([0.22, 0.65, 0.36], [0.04, 0.06, 0.04], HANDLE),
    // brand/logo panel (image target)
    panel('logo', [0, 0.55, 0.37], [0.3, 0.12, 0.01], GREY),
    // temperature dial
    box([0.28, 0.5, 0.37], [0.04, 0.04, 0.01], DARK),
    // wheels / feet
    box([-0.35, 0.03, -0.3], [0.06, 0.04, 0.06], DARK),
    box([0.35, 0.03, -0.3], [0.06, 0.04, 0.06], DARK),
    box([-0.35, 0.03, 0.3], [0.06, 0.04, 0.06], DARK),
    box([0.35, 0.03, 0.3], [0.06, 0.04, 0.06], DARK),
  ];
}
