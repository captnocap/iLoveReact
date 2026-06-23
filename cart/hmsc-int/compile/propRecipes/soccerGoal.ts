import {
  lowerPropRecipe,
  recipeColor,
  type Color,
  type PropPartSpec,
  type PropRecipe,
  type PropRecipePart,
} from './types';
import { type PropKindDefinition } from '../../game/kinds/props';

export const soccerGoalDef: PropKindDefinition = {
  kind: 'soccerGoal',
  label: 'Soccer Goal',
  solid: true,
  footprintRadiusMeters: 1.4,
  heightMeters: 1.2,
  tileKind: 'wall',
  trafficControl: 'none',
};

const COLORS = {
  main: recipeColor('#eef0f2'),
} satisfies Record<string, Color>;

export function soccerGoalRecipe(): PropRecipe {
  const parts: PropRecipePart[] = [
    {
      id: 'body',
      shape: 'box',
      position: { x: 0, y: 0.600, z: 0 },
      size: { width: 2.520, height: 1.200, depth: 2.240 },
      color: COLORS.main,
    },
  ];
  return { id: 'soccerGoal', parts };
}

export function soccerGoalParts(): PropPartSpec[] {
  return lowerPropRecipe(soccerGoalRecipe());
}
