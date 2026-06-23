import { box, hx, type PropPartSpec } from '../../game/kinds/propModels';
import { type PropKindDefinition } from '../../game/kinds/props';

export const rugRunnerDef: PropKindDefinition = {
  kind: 'rugRunner',
  label: 'Runner Rug',
  solid: true,
  footprintRadiusMeters: 0.4,
  footprintDepthMeters: 2.0,
  heightMeters: 0.04,
  tileKind: 'wall',
  trafficControl: 'none',
  coverClass: 'soft',
};

export function rugRunnerParts(): PropPartSpec[] {
  const brown = hx('#6b4a2e');
  const rust = hx('#7d4f43');
  const tan = hx('#8a6a4a');
  const fringe = hx('#d6c69a');
  const w = 0.8;
  const d = 2.0;
  const parts: PropPartSpec[] = [
    box([0, 0.02, 0], [w, 0.04, d], brown),
    box([0, 0.04, 0], [w - 0.15, 0.015, d - 0.3], rust),
    box([0, 0.045, 0], [w - 0.4, 0.015, d - 0.7], tan),
  ];
  // fringe tassels at both ends
  const tasselW = 0.02;
  const tasselH = 0.025;
  const tasselD = 0.04;
  const count = 8;
  for (let i = 0; i < count; i++) {
    const x = -w / 2 + 0.04 + i * ((w - 0.08) / (count - 1));
    parts.push(box([x, 0.03, d / 2 + 0.01], [tasselW, tasselH, tasselD], fringe));
    parts.push(box([x, 0.03, -d / 2 - 0.01], [tasselW, tasselH, tasselD], fringe));
  }
  return parts;
}
