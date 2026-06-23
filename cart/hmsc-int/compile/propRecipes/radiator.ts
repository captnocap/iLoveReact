import { box, hx, type PropPartSpec } from '../../game/kinds/propModels';
import { type PropKindDefinition } from '../../game/kinds/props';

export const radiatorDef: PropKindDefinition = {
  kind: 'radiator',
  label: 'Radiator',
  solid: true,
  footprintRadiusMeters: 0.25,
  footprintDepthMeters: 0.15,
  heightMeters: 0.8,
  tileKind: 'wall',
  trafficControl: 'none',
  mount: 'wall',
  coverClass: 'none',
};

export function radiatorParts(): PropPartSpec[] {
  const w = 0.5;
  const h = 0.8;
  const parts: PropPartSpec[] = [];
  for (let i = 0; i < 5; i++) {
    const x = -w / 2 + 0.05 + i * (w / 5);
    parts.push(box([x, h / 2, 0], [0.05, h, 0.15], hx('#d6d9dc')));
  }
  parts.push(box([0, h - 0.04, 0], [w, 0.04, 0.12], hx('#aab0b6')));
  parts.push(box([0, 0.04, 0], [w, 0.04, 0.12], hx('#aab0b6')));
  return parts;
}
