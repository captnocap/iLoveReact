import {
  lowerPropRecipe,
  recipeColor,
  type Color,
  type PropPartSpec,
  type PropRecipe,
  type PropRecipePart,
} from './types';
import { type PropKindDefinition } from '../../game/kinds/props';

export const mattressDef: PropKindDefinition = {
  kind: 'mattress',
  label: 'Mattress',
  solid: true,
  footprintRadiusMeters: 0.55,
  footprintDepthMeters: 1.0,
  heightMeters: 0.35,
  tileKind: 'wall',
  trafficControl: 'none',
  seat: { pose: 'lay', seatHeightMeters: 0.2, capacity: 1 },
  coverClass: 'soft',
};

const COLORS = {
  sheet: recipeColor('#ece8dd'),
  stain: recipeColor('#c2b89a'),
} satisfies Record<string, Color>;

export function mattressRecipe(): PropRecipe {
  const w = 1.1;
  const d = 1.0;
  const h = 0.35;
  const parts: PropRecipePart[] = [
    { id: 'body', shape: 'box', position: { x: 0, y: h / 2, z: 0 }, size: { width: w, height: h * 0.85, depth: d }, color: COLORS.sheet },
    { id: 'top', shape: 'box', position: { x: 0, y: h * 0.78, z: 0 }, size: { width: w * 0.98, height: 0.08, depth: d * 0.98 }, color: COLORS.stain },
  ];
  return { id: 'mattress', parts };
}

export function mattressParts(): PropPartSpec[] {
  return lowerPropRecipe(mattressRecipe());
}
