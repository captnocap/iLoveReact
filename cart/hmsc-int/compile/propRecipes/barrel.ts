import { cylinder16, METAL, WOOD, WOOD_DARK, type PropPartSpec } from '../../game/kinds/propModels';
import { propKindDefinition } from '../../game/kinds/props';

import { type PropKindDefinition } from '../../game/kinds/props';

export const barrelDef: PropKindDefinition = {
  kind: 'barrel',
  label: 'Wooden Barrel',
  solid: true,
  footprintRadiusMeters: 0.36,
  heightMeters: 1.0,
  tileKind: 'wall',
  trafficControl: 'none',
  container: { lootCategory: 'junk', capacity: 3, spawnFillChance: 0.5, searchSeconds: 2.5, access: 'open' },
  coverClass: 'soft',
};

export function barrelParts(): PropPartSpec[] {
  const h = propKindDefinition('barrel').heightMeters;
  return [
    cylinder16([0, h * 0.13, 0], 0.3, h * 0.26, WOOD),
    cylinder16([0, h * 0.5, 0], 0.35, h * 0.52, WOOD),
    cylinder16([0, h * 0.87, 0], 0.3, h * 0.26, WOOD),
    cylinder16([0, h * 0.28, 0], 0.355, h * 0.06, METAL),
    cylinder16([0, h * 0.72, 0], 0.355, h * 0.06, METAL),
    cylinder16([0, h - 0.01, 0], 0.27, 0.04, WOOD_DARK),
  ];
}
