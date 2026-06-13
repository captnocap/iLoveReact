import { box, hx, NEAR_BLACK, STEEL, type PropPartSpec } from '../../game/kinds/propModels';
import { propKindDefinition } from '../../game/kinds/props';

import { type PropKindDefinition } from '../../game/kinds/props';

export const lockerSetDef: PropKindDefinition = {
  kind: 'lockerSet',
  label: 'Lockers',
  solid: true,
  footprintRadiusMeters: 0.45,
  heightMeters: 2.1,
  tileKind: 'wall',
  trafficControl: 'none',
  container: { lootCategory: 'clothing', capacity: 4, spawnFillChance: 0.5, searchSeconds: 3, access: 'locked' },
};

export function lockerSetParts(): PropPartSpec[] {
  const def = propKindDefinition('lockerSet');
  const h = def.heightMeters;
  const blue = hx('#2563a8');
  const blueDark = hx('#1b4a80');
  const parts: PropPartSpec[] = [
    box([0, 0.05, 0], [0.9, 0.1, 0.5], NEAR_BLACK),
    box([0, h / 2 + 0.04, 0], [0.9, h - 0.12, 0.5], blue),
  ];
  for (const x of [-0.15, 0.15]) parts.push(box([x, h / 2, -0.252], [0.015, h - 0.3, 0.015], blueDark));
  for (const x of [-0.3, 0, 0.3]) {
    parts.push(box([x, h - 0.35, -0.255], [0.18, 0.045, 0.012], blueDark)); // vent
    parts.push(box([x + 0.1, h * 0.55, -0.26], [0.025, 0.07, 0.02], STEEL)); // handle
  }
  return parts;
}
