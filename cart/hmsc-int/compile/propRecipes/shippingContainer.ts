import { box, hx, STEEL_DARK, type PropPartSpec } from '../../game/kinds/propModels';
import { propKindDefinition } from '../../game/kinds/props';

import { type PropKindDefinition } from '../../game/kinds/props';

export const shippingContainerDef: PropKindDefinition = {
  kind: 'shippingContainer',
  label: 'Shipping Container',
  // Real 20ft box (6.06 × 2.44 × 2.59) × 1.15. Long — yaw-aware thin AABB.
  solid: true,
  footprintRadiusMeters: 3.5,
  heightMeters: 3.0,
  tileKind: 'wall',
  trafficControl: 'none',
  container: { lootCategory: 'tools', capacity: 8, spawnFillChance: 0.6, searchSeconds: 5, access: 'locked' },
  coverClass: 'hard',
};

export function shippingContainerParts(): PropPartSpec[] {
  const def = propKindDefinition('shippingContainer');
  const len = def.footprintRadiusMeters * 2;
  const h = def.heightMeters;
  const w = 2.8;
  const body = hx('#8a3324');
  const dark = hx('#6e2818');
  const parts: PropPartSpec[] = [
    box([0, h / 2, 0], [len, h - 0.1, w - 0.12], body),
    box([0, h - 0.04, 0], [len, 0.08, w], dark),
    box([0, 0.05, 0], [len, 0.1, w], dark),
  ];
  // side corrugation ridges
  for (const sz of [-1, 1]) {
    parts.push(box([0, h * 0.35, sz * (w / 2 - 0.03)], [len - 0.3, 0.16, 0.07], dark));
    parts.push(box([0, h * 0.7, sz * (w / 2 - 0.03)], [len - 0.3, 0.16, 0.07], dark));
  }
  // door end: two leaves + lock rods
  parts.push(box([len / 2 - 0.02, h / 2, -w / 4 + 0.03], [0.08, h - 0.2, w / 2 - 0.12], dark));
  parts.push(box([len / 2 - 0.02, h / 2, w / 4 - 0.03], [0.08, h - 0.2, w / 2 - 0.12], dark));
  for (const z of [-0.95, -0.45, 0.45, 0.95]) parts.push(box([len / 2 + 0.04, h / 2, z], [0.05, h - 0.4, 0.06], STEEL_DARK));
  return parts;
}
