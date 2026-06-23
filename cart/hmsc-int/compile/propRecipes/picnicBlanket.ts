import { box, hx, type PropPartSpec } from '../../game/kinds/propModels';
import { type PropKindDefinition } from '../../game/kinds/props';

export const picnicBlanketDef: PropKindDefinition = {
  kind: 'picnicBlanket',
  label: 'Picnic Blanket',
  solid: true,
  footprintRadiusMeters: 1.0,
  heightMeters: 0.05,
  tileKind: 'wall',
  trafficControl: 'none',
  coverClass: 'soft',
};

export function picnicBlanketParts(): PropPartSpec[] {
  const green = hx('#3a7d80');
  const white = hx('#eef0f2');
  const red = hx('#b3221c');
  const parts: PropPartSpec[] = [
    box([0, 0.015, 0], [2.0, 0.03, 1.6], green),
    // stripes
    box([0, 0.03, 0], [1.8, 0.01, 0.22], white),
    box([0, 0.03, 0.38], [1.8, 0.01, 0.22], white),
    box([0, 0.03, -0.38], [1.8, 0.01, 0.22], white),
    // a rumpled fold
    box([0.3, 0.04, 0.15], [0.8, 0.02, 0.12], green, [2, 10, -3]),
    box([-0.4, 0.045, -0.2], [0.6, 0.015, 0.1], red, [-3, -5, 4]),
  ];
  // tassels around the edge
  const w = 2.0;
  const d = 1.6;
  const tasselY = 0.035;
  const tasselW = 0.06;
  const tasselH = 0.03;
  const tasselD = 0.03;
  const spacing = 0.25;
  for (let x = -w / 2 + spacing; x <= w / 2 - spacing; x += spacing) {
    parts.push(box([x, tasselY, d / 2], [tasselW, tasselH, tasselD], white));
    parts.push(box([x, tasselY, -d / 2], [tasselW, tasselH, tasselD], white));
  }
  for (let z = -d / 2 + spacing; z <= d / 2 - spacing; z += spacing) {
    parts.push(box([w / 2, tasselY, z], [tasselD, tasselH, tasselW], white));
    parts.push(box([-w / 2, tasselY, z], [tasselD, tasselH, tasselW], white));
  }
  // corner tassels
  parts.push(box([w / 2, tasselY, d / 2], [tasselD, tasselH, tasselD], white));
  parts.push(box([w / 2, tasselY, -d / 2], [tasselD, tasselH, tasselD], white));
  parts.push(box([-w / 2, tasselY, d / 2], [tasselD, tasselH, tasselD], white));
  parts.push(box([-w / 2, tasselY, -d / 2], [tasselD, tasselH, tasselD], white));
  return parts;
}
