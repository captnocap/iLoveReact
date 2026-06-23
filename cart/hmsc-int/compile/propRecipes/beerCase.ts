import { type PropKindDefinition } from '../../game/kinds/props';
import { box, hx, NEAR_BLACK, type PropPartSpec } from '../../game/kinds/propModels';

export function beerCaseParts(): PropPartSpec[] {
  return [
    box([0, 0.14, 0], [0.5, 0.28, 0.34], hx('#b03028')),
    box([0, 0.41, 0.02], [0.48, 0.26, 0.33], hx('#d8b23a'), [0, 6, 0]),
    box([0, 0.28, -0.01], [0.46, 0.03, 0.3], NEAR_BLACK),
  ];
}

export const beerCaseDef: PropKindDefinition = {
  kind: 'beerCase',
  label: 'Beer Cases',
  solid: true,
  footprintRadiusMeters: 0.25,
  heightMeters: 0.55,
  tileKind: 'wall',
  trafficControl: 'none',
};
