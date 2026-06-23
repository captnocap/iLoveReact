import { box, hx, type PropPartSpec } from '../../game/kinds/propModels';
import { type PropKindDefinition } from '../../game/kinds/props';

export const katanaDef: PropKindDefinition = {
  kind: 'katana',
  label: 'Katana',
  solid: true,
  footprintRadiusMeters: 0.4,
  footprintDepthMeters: 0.08,
  heightMeters: 0.12,
  tileKind: 'wall',
  trafficControl: 'none',
  mount: 'surface',
  coverClass: 'none',
};

export function katanaParts(): PropPartSpec[] {
  return [
    box([0, 0.02, 0], [0.9, 0.02, 0.03], hx('#9aa1ab'), [0, 0, 4]),
    box([0.32, 0.025, 0], [0.12, 0.04, 0.04], hx('#6b4a2e'), [0, 0, 4]),
    box([0.42, 0.028, 0], [0.05, 0.02, 0.05], hx('#22262b'), [0, 0, 4]),
  ];
}
