import { cylinder8, STEEL, STEEL_DARK, type Color, type PropPartSpec } from '../../game/kinds/propModels';

import { type PropKindDefinition } from '../../game/kinds/props';

export const pipeStackDef: PropKindDefinition = {
  kind: 'pipeStack',
  label: 'Pipe Stack',
  // A pyramid of steel pipes lying along local X (yaw-aware AABB).
  solid: true,
  footprintRadiusMeters: 1.75,
  heightMeters: 1.0,
  tileKind: 'wall',
  trafficControl: 'none',
};

export function pipeStackParts(): PropPartSpec[] {
  const len = 3.4;
  const r = 0.17;
  const rows: [number, number, Color][] = [
    [-0.36, r, STEEL], [0, r, STEEL_DARK], [0.36, r, STEEL],
    [-0.18, r * 2 + 0.12, STEEL_DARK], [0.18, r * 2 + 0.12, STEEL],
    [0, r * 3 + 0.26, STEEL_DARK],
  ];
  return rows.map(([z, y, color]) => cylinder8([0, y, z], r, len, color, [0, 0, 90]));
}
