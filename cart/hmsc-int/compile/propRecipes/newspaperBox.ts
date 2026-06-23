import { box, hx, type PropPartSpec } from '../../game/kinds/propModels';
import { type PropKindDefinition } from '../../game/kinds/props';

export const newspaperBoxDef: PropKindDefinition = {
  kind: 'newspaperBox',
  label: 'Newspaper Box',
  solid: true,
  footprintRadiusMeters: 0.25,
  footprintDepthMeters: 0.45,
  heightMeters: 0.95,
  tileKind: 'wall',
  trafficControl: 'none',
  container: { lootCategory: 'junk', capacity: 2, spawnFillChance: 0.4, searchSeconds: 1.5, access: 'open' },
  coverClass: 'soft',
};

export function newspaperBoxParts(): PropPartSpec[] {
  const body = hx('#3a7d80');
  const window = hx('#2c4a66');
  const dark = hx('#22262b');
  const paper = hx('#eef0f2');
  return [
    box([0, 0.45, 0], [0.5, 0.9, 0.45], body),
    box([0, 0.8, -0.23], [0.35, 0.12, 0.02], window),
    box([0, 0.2, -0.23], [0.25, 0.35, 0.02], dark),
    // coin slot
    box([0.08, 0.82, -0.24], [0.06, 0.01, 0.01], dark),
    // papers visible inside
    box([0, 0.22, -0.22], [0.2, 0.28, 0.02], paper),
    box([0.02, 0.25, -0.215], [0.18, 0.22, 0.02], paper, [0, 0, 5]),
    box([0, 0.95, 0], [0.52, 0.04, 0.47], dark),
    // feet
    box([-0.2, 0.04, -0.18], [0.06, 0.06, 0.06], dark),
    box([0.2, 0.04, -0.18], [0.06, 0.06, 0.06], dark),
    box([-0.2, 0.04, 0.18], [0.06, 0.06, 0.06], dark),
    box([0.2, 0.04, 0.18], [0.06, 0.06, 0.06], dark),
  ];
}
