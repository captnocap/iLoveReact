import { box, hx, type Color, type PropPartSpec } from '../../game/kinds/propModels';
import { type PropKindDefinition } from '../../game/kinds/props';

export const fishtankDef: PropKindDefinition = {
  kind: 'fishtank',
  label: 'Fish Tank',
  solid: true,
  footprintRadiusMeters: 0.55,
  footprintDepthMeters: 0.35,
  heightMeters: 0.45,
  tileKind: 'wall',
  trafficControl: 'none',
  mount: 'surface',
  coverClass: 'none',
};

const GLASS: Color = hx('#bcd3dd');

export function fishtankParts(): PropPartSpec[] {
  const w = 1.1;
  const d = 0.35;
  const h = 0.45;
  return [
    { shape: 'box', local: [0, h / 2, 0], size: [w, h, d], color: GLASS, opacity: 0.3 }, // glass
    box([0, 0.06, 0], [w * 0.9, 0.08, d * 0.8], hx('#8a6240')), // gravel
    box([0.15, 0.18, -0.05], [0.12, 0.04, 0.02], hx('#ff8c42')), // fish
    box([-0.1, 0.24, 0.05], [0.1, 0.03, 0.02], hx('#3a7d80')), // fish
    box([0, h + 0.02, 0], [w + 0.04, 0.04, d + 0.04], hx('#22262b')), // lid
  ];
}
