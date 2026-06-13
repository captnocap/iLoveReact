import { cylinder8, cylinder16, hx, METAL, WOOD_DARK, WOOD_PALE, type PropPartSpec } from '../../game/kinds/propModels';
import { propKindDefinition } from '../../game/kinds/props';

import { type PropKindDefinition } from '../../game/kinds/props';

export const cableSpoolDef: PropKindDefinition = {
  kind: 'cableSpool',
  label: 'Cable Spool',
  // The wooden spool — street furniture's free table; you can sit on it.
  solid: true,
  footprintRadiusMeters: 0.8,
  heightMeters: 0.95,
  tileKind: 'wall',
  trafficControl: 'none',
  seat: { pose: 'sit', seatHeightMeters: 0.95, capacity: 2 },
};

export function cableSpoolParts(): PropPartSpec[] {
  const def = propKindDefinition('cableSpool');
  const r = def.footprintRadiusMeters;
  const h = def.heightMeters;
  return [
    cylinder16([0, 0.06, 0], r, 0.12, WOOD_PALE),
    cylinder16([0, h - 0.06, 0], r, 0.12, WOOD_PALE),
    cylinder16([0, h / 2, 0], r * 0.42, h - 0.24, WOOD_DARK),
    cylinder16([0, h / 2, 0], r * 0.62, h - 0.36, hx('#23262a')),
    cylinder8([0, h + 0.015, 0], 0.06, 0.05, METAL),
  ];
}
