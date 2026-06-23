import { box, cylinder8, hx, type PropPartSpec } from '../../game/kinds/propModels';
import { type PropKindDefinition } from '../../game/kinds/props';

export const electricBoxDef: PropKindDefinition = {
  kind: 'electricBox',
  label: 'Electric Box',
  solid: true,
  footprintRadiusMeters: 0.25,
  footprintDepthMeters: 0.15,
  heightMeters: 0.65,
  tileKind: 'wall',
  trafficControl: 'none',
  mount: 'wall',
  coverClass: 'none',
};

export function electricBoxParts(): PropPartSpec[] {
  const boxColor = hx('#9aa1ab');
  const door = hx('#6c727b');
  const bolt = hx('#22262b');
  const warning = hx('#d4a83a');
  const pipe = hx('#6c727b');
  return [
    box([0, 0.35, 0], [0.5, 0.65, 0.15], boxColor),
    box([0, 0.35, -0.08], [0.4, 0.5, 0.02], door),
    // warning label
    box([0, 0.55, -0.09], [0.1, 0.1, 0.01], warning),
    // door bolts
    box([-0.16, 0.55, -0.095], [0.02, 0.02, 0.01], bolt),
    box([0.16, 0.55, -0.095], [0.02, 0.02, 0.01], bolt),
    box([-0.16, 0.22, -0.095], [0.02, 0.02, 0.01], bolt),
    box([0.16, 0.22, -0.095], [0.02, 0.02, 0.01], bolt),
    // handle
    box([0.12, 0.38, -0.095], [0.04, 0.08, 0.015], bolt),
    // conduit entering from below
    cylinder8([0, 0.08, 0], 0.04, 0.16, pipe),
    // conduit elbow heading into wall
    cylinder8([0, 0.02, 0.08], 0.03, 0.14, pipe, [90, 0, 0]),
  ];
}
