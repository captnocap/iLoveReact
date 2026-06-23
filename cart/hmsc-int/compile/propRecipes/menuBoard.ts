import { type PropKindDefinition } from '../../game/kinds/props';
import { box, hx, NEAR_BLACK, panel, type PropPartSpec } from '../../game/kinds/propModels';

export function menuBoardParts(): PropPartSpec[] {
  return [
    box([0, 2.0, -0.03], [1.84, 0.94, 0.05], NEAR_BLACK),
    // the menu — image target
    panel('face', [0, 2.0, -0.06], [1.7, 0.8, 0.02], hx('#15314e')),
  ];
}

export const menuBoardDef: PropKindDefinition = {
  kind: 'menuBoard',
  label: 'Menu Board',
  solid: true,
  footprintRadiusMeters: 0.08,
  heightMeters: 2.6,
  tileKind: 'wall',
  trafficControl: 'none',
  mount: 'wall',
  coverClass: 'none',
};
