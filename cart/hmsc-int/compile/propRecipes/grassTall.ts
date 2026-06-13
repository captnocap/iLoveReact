import { GRASS_DRY, sphere, type PropPartSpec } from '../../game/kinds/propModels';
import { propKindDefinition } from '../../game/kinds/props';
import { grassField } from './grassPatch';

export function grassTallParts(): PropPartSpec[] {
  const parts = grassField('grassTall');
  const def = propKindDefinition('grassTall');
  // seed heads poking above the tall tufts
  parts.push(sphere([def.footprintRadiusMeters * 0.3, def.heightMeters * 0.95, 0.1], [0.07, 0.12, 0.07], GRASS_DRY));
  parts.push(sphere([-def.footprintRadiusMeters * 0.25, def.heightMeters * 0.88, -0.15], [0.07, 0.12, 0.07], GRASS_DRY));
  return parts;
}
